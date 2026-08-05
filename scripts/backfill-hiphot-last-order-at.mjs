#!/usr/bin/env node
/**
 * Backfill HipHot lead.last_order_at from HubSpot ecommerce deals.
 *
 * Default is a dry-run. Use --commit with --approved-report=<dry-run-report>
 * after reviewing the planned changes.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const DEFAULT_REPORT = "/tmp/hiphot-last-order-at-backfill.json";
const ECOMMERCE_PIPELINE_IDS = new Set(["707050616", "ecommerce"]);
const ECOMMERCE_WON_STAGE_IDS = new Set([
  "1033277858", // Processing
  "1033277859", // Completed
]);

const args = process.argv.slice(2);
const DRY = !args.includes("--commit");
const dealsPath = argValue("--deals");
const reportPath = argValue("--report") || DEFAULT_REPORT;
const approvedReportPath = argValue("--approved-report");
const limit = Number(argValue("--limit") || 0);

function argValue(name) {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
}

function readRows(filePath) {
  if (!filePath) throw new Error("Geef --deals=/pad/naar/hubspot-deals.xlsx mee.");
  if (!fs.existsSync(filePath)) throw new Error(`Bestand niet gevonden: ${filePath}`);
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[\uFEFF]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function rowIndex(row) {
  const index = new Map();
  for (const [key, value] of Object.entries(row)) {
    index.set(normalizeKey(key), value);
  }
  return index;
}

function get(row, aliases) {
  const index = row.__index || rowIndex(row);
  row.__index = index;
  for (const alias of aliases) {
    const value = index.get(normalizeKey(alias));
    if (value !== undefined && String(value).trim() !== "") return value;
  }
  return "";
}

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isEcommerceWonDeal(row) {
  const pipeline = lower(get(row, ["Pipeline", "Pijplijn"]));
  const stage = lower(get(row, ["Deal stage", "Stage", "Dealstadium", "Pipeline stage"]));
  return ECOMMERCE_PIPELINE_IDS.has(pipeline) && ECOMMERCE_WON_STAGE_IDS.has(stage);
}

function parseDeal(row) {
  const closeDate = cleanDate(get(row, ["Close date", "Closed date", "Sluitdatum"]));
  const createDate = cleanDate(get(row, ["Create date", "Created date", "Aanmaakdatum"]));
  const date = closeDate || createDate;
  return {
    deal_id: text(get(row, ["Record ID", "Deal ID", "HubSpot Deal ID", "hs_object_id"])),
    hubspot_company_id: text(get(row, [
      "Associated Company ID",
      "Associated company IDs",
      "Company ID",
      "Primary associated company ID",
      "Associated company record ID",
    ])).split(/[;,]/)[0]?.trim() || "",
    company_name: text(get(row, ["Company name", "Associated company", "Associated Company", "Bedrijf", "Organisatie"])),
    domain: lower(get(row, ["Company domain name", "Domain", "Domein"])),
    deal_name: text(get(row, ["Deal name", "Deal Name", "Naam", "Dealnaam"])),
    pipeline: text(get(row, ["Pipeline", "Pijplijn"])),
    stage: text(get(row, ["Deal stage", "Stage", "Dealstadium", "Pipeline stage"])),
    date,
    is_ecommerce_won: isEcommerceWonDeal(row),
  };
}

async function fetchAllRows(queryFactory, label) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw new Error(`Kon ${label} niet ophalen: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function buildLeadMaps(leads) {
  const byHubspotCompanyId = new Map();
  const byCompanyName = new Map();
  const byDomain = new Map();
  for (const lead of leads) {
    if (lead.hubspot_company_id) byHubspotCompanyId.set(String(lead.hubspot_company_id), lead);
    if (lead.company_name) {
      const key = lower(lead.company_name);
      if (!byCompanyName.has(key)) byCompanyName.set(key, []);
      byCompanyName.get(key).push(lead);
    }
    if (lead.website_url) {
      const domain = lower(String(lead.website_url).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
      if (domain) byDomain.set(domain, lead);
    }
  }
  return { byHubspotCompanyId, byCompanyName, byDomain };
}

function findLeadForDeal(deal, maps) {
  if (deal.hubspot_company_id && maps.byHubspotCompanyId.has(deal.hubspot_company_id)) {
    return { lead: maps.byHubspotCompanyId.get(deal.hubspot_company_id), match: "hubspot_company_id" };
  }
  if (deal.domain && maps.byDomain.has(deal.domain)) {
    return { lead: maps.byDomain.get(deal.domain), match: "domain" };
  }
  const nameMatches = maps.byCompanyName.get(lower(deal.company_name)) || [];
  if (nameMatches.length === 1) return { lead: nameMatches[0], match: "company_name" };
  return { lead: null, match: nameMatches.length > 1 ? "ambiguous_company_name" : "none" };
}

function newestPlanByLead(deals, maps) {
  const plans = new Map();
  const unmatched = [];
  for (const deal of deals) {
    if (!deal.is_ecommerce_won || !deal.date) continue;
    const { lead, match } = findLeadForDeal(deal, maps);
    if (!lead) {
      unmatched.push({ ...deal, match });
      continue;
    }
    const existing = plans.get(lead.id);
    const incomingTime = new Date(deal.date).getTime();
    const existingPlanTime = existing ? new Date(existing.last_order_at).getTime() : 0;
    if (!existing || incomingTime > existingPlanTime) {
      plans.set(lead.id, {
        lead_id: lead.id,
        company_name: lead.company_name,
        hubspot_company_id: lead.hubspot_company_id,
        previous_last_order_at: lead.last_order_at,
        last_order_at: deal.date,
        match,
        source_deal: {
          deal_id: deal.deal_id,
          deal_name: deal.deal_name,
          pipeline: deal.pipeline,
          stage: deal.stage,
          close_date: deal.date,
        },
      });
    }
  }
  return { plans: [...plans.values()], unmatched };
}

function shouldUpdate(plan) {
  if (!plan.last_order_at) return false;
  if (!plan.previous_last_order_at) return true;
  const previous = new Date(plan.previous_last_order_at).getTime();
  const incoming = new Date(plan.last_order_at).getTime();
  return !Number.isNaN(incoming) && (Number.isNaN(previous) || incoming > previous);
}

function reportSignature(report) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      tenant: report.tenant,
      input: report.input,
      planned_updates: report.planned_updates,
      updates: report.updates,
    }))
    .digest("hex");
}

function writeReport(report) {
  report.approval_signature = reportSignature(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function loadApprovedReport() {
  if (!approvedReportPath) throw new Error("Commit vereist --approved-report=/pad/naar/dry-run-report.json.");
  if (!fs.existsSync(approvedReportPath)) throw new Error(`Goedgekeurd rapport niet gevonden: ${approvedReportPath}`);
  return JSON.parse(fs.readFileSync(approvedReportPath, "utf8"));
}

async function main() {
  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service-role env-vars ontbreken.");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dealRows = readRows(dealsPath);
  const deals = dealRows.map(parseDeal);
  const ecommerceWonDeals = deals.filter((deal) => deal.is_ecommerce_won && deal.date);
  const leads = await fetchAllRows(
    () => supabase
      .from("leads")
      .select("id, tenant, company_name, website_url, hubspot_company_id, last_order_at")
      .eq("tenant", TENANT)
      .order("id", { ascending: true }),
    "HipHot leads"
  );
  const maps = buildLeadMaps(leads);
  const { plans, unmatched } = newestPlanByLead(deals, maps);
  const updates = plans
    .filter(shouldUpdate)
    .sort((a, b) => b.last_order_at.localeCompare(a.last_order_at) || a.company_name.localeCompare(b.company_name))
    .slice(0, limit > 0 ? limit : undefined);

  const report = {
    mode: DRY ? "dry-run" : "commit",
    tenant: TENANT,
    generated_at: new Date().toISOString(),
    input: {
      dealsPath,
      dealRows: dealRows.length,
      ecommerceWonDeals: ecommerceWonDeals.length,
      existingLeads: leads.length,
      limit: limit || null,
    },
    planned_updates: updates.length,
    matched_companies_with_order: plans.length,
    unmatched_ecommerce_won_deals: unmatched.length,
    recent_order_14_days_updates: updates.filter((plan) => new Date(plan.last_order_at).getTime() >= Date.now() - 14 * 24 * 60 * 60 * 1000).length,
    updates,
    unmatched_samples: unmatched.slice(0, 25),
  };

  if (!DRY) {
    const approved = loadApprovedReport();
    const expectedSignature = reportSignature({ ...approved, mode: "dry-run" });
    if (!approved.approval_signature || approved.approval_signature !== expectedSignature) {
      throw new Error("Goedgekeurd rapport heeft geen geldige approval_signature.");
    }
    if (approved.planned_updates !== updates.length) {
      throw new Error(`Dry-run rapport verwachtte ${approved.planned_updates} updates, nu ${updates.length}. Draai eerst opnieuw dry-run.`);
    }
    for (const update of updates) {
      const { error } = await supabase
        .from("leads")
        .update({ last_order_at: update.last_order_at, updated_at: new Date().toISOString() })
        .eq("tenant", TENANT)
        .eq("id", update.lead_id);
      if (error) throw new Error(`${update.company_name}: ${error.message}`);
    }
  }

  writeReport(report);
  console.log(`HipHot last_order_at backfill ${report.mode}`);
  console.log(`Deals: ${report.input.dealRows}`);
  console.log(`Ecommerce gewonnen deals: ${report.input.ecommerceWonDeals}`);
  console.log(`Te updaten bedrijven: ${report.planned_updates}`);
  console.log(`Recent besteld binnen 14 dagen: ${report.recent_order_14_days_updates}`);
  console.log(`Rapport: ${reportPath}`);
  if (DRY) console.log(`Approval signature: ${report.approval_signature}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

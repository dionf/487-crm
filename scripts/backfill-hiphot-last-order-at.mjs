#!/usr/bin/env node
/**
 * Backfill HipHot lead.last_order_at from WooCommerce orders.
 *
 * WooCommerce is the source of truth for real HipHot purchases. Default is a
 * dry-run. Use --commit with --approved-report=<dry-run-report> after reviewing
 * the planned changes.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const DEFAULT_REPORT = "/tmp/hiphot-last-order-at-backfill.json";
const DEFAULT_ORDER_STATUSES = ["completed", "processing", "on-hold", "pending"];
const PAGE_SIZE = 100;

const args = process.argv.slice(2);
const DRY = !args.includes("--commit");
const clearMissing = args.includes("--clear-missing");
const reportPath = argValue("--report") || DEFAULT_REPORT;
const approvedReportPath = argValue("--approved-report");
const limit = Number(argValue("--limit") || 0);
const statuses = (argValue("--statuses") || DEFAULT_ORDER_STATUSES.join(","))
  .split(",")
  .map((status) => status.trim())
  .filter(Boolean);

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ontbreekt.`);
  return value;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePostcode(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function normalizeCompany(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(bv|b\.v|vof|v\.o\.f|stichting|the|de|het)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function orderDate(order) {
  return (
    cleanDate(order.date_paid_gmt) ||
    cleanDate(order.date_completed_gmt) ||
    cleanDate(order.date_created_gmt) ||
    cleanDate(order.date_paid) ||
    cleanDate(order.date_completed) ||
    cleanDate(order.date_created)
  );
}

function getWooConfig() {
  const baseUrl = requireEnv("HIPHOT_WC_URL").replace(/\/$/, "");
  const auth = Buffer.from(`${requireEnv("HIPHOT_WC_KEY")}:${requireEnv("HIPHOT_WC_SECRET")}`).toString("base64");
  return { baseUrl, auth };
}

async function fetchWooOrdersForStatus({ baseUrl, auth }, status) {
  const orders = [];
  let totalPages = 1;
  let total = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    const url = new URL(`${baseUrl}/wp-json/wc/v3/orders`);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", status);
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`WooCommerce orders ophalen mislukt voor ${status}: ${data?.message || res.status}`);
    }
    totalPages = Number(res.headers.get("x-wp-totalpages") || totalPages);
    total = Number(res.headers.get("x-wp-total") || total);
    orders.push(...(Array.isArray(data) ? data : []));
  }
  return { status, total, orders };
}

async function fetchWooOrders() {
  const config = getWooConfig();
  const perStatus = [];
  for (const status of statuses) {
    perStatus.push(await fetchWooOrdersForStatus(config, status));
  }
  const ordersById = new Map();
  for (const result of perStatus) {
    for (const order of result.orders) ordersById.set(String(order.id), order);
  }
  return {
    perStatus: perStatus.map(({ status, total, orders }) => ({ status, total, fetched: orders.length })),
    orders: [...ordersById.values()],
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

function addUniqueMapEntry(map, key, leadId) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(leadId);
}

function buildLeadMaps(leads, contacts) {
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const byEmail = new Map();
  const byCompanyPostcode = new Map();

  for (const lead of leads) {
    addUniqueMapEntry(byEmail, normalizeEmail(lead.email), lead.id);
    const company = normalizeCompany(lead.company_name);
    const postcodes = [lead.billing_postal_code, lead.delivery_postal_code]
      .map(normalizePostcode)
      .filter(Boolean);
    for (const postcode of postcodes) {
      addUniqueMapEntry(byCompanyPostcode, `${company}|${postcode}`, lead.id);
    }
  }

  for (const contact of contacts) {
    addUniqueMapEntry(byEmail, normalizeEmail(contact.email), contact.lead_id);
  }

  return { byId, byEmail, byCompanyPostcode };
}

function exactOne(map, key) {
  const ids = map.get(key);
  if (!ids || ids.size !== 1) return null;
  return [...ids][0];
}

function findLeadForOrder(order, maps) {
  const emails = [
    order.billing?.email,
    ...(Array.isArray(order.meta_data)
      ? order.meta_data
          .filter((item) => /email/i.test(String(item.key || "")))
          .map((item) => item.value)
      : []),
  ].map(normalizeEmail).filter(Boolean);

  const emailMatches = new Set();
  for (const email of emails) {
    const ids = maps.byEmail.get(email);
    if (ids) for (const id of ids) emailMatches.add(id);
  }
  if (emailMatches.size === 1) return { lead: maps.byId.get([...emailMatches][0]), match: "email" };

  const companyPostcodeKeys = [
    [order.billing?.company, order.billing?.postcode],
    [order.shipping?.company, order.shipping?.postcode],
  ]
    .map(([company, postcode]) => `${normalizeCompany(company)}|${normalizePostcode(postcode)}`)
    .filter((key) => !key.startsWith("|") && !key.endsWith("|"));

  const companyMatches = new Set();
  for (const key of companyPostcodeKeys) {
    const id = exactOne(maps.byCompanyPostcode, key);
    if (id) companyMatches.add(id);
  }
  if (emailMatches.size > 1 && companyMatches.size === 1) {
    const companyMatchId = [...companyMatches][0];
    if (emailMatches.has(companyMatchId)) {
      return { lead: maps.byId.get(companyMatchId), match: "ambiguous_email_company_postcode" };
    }
  }
  if (emailMatches.size > 1) return { lead: null, match: "ambiguous_email" };
  if (companyMatches.size === 1) return { lead: maps.byId.get([...companyMatches][0]), match: "company_postcode" };
  if (companyMatches.size > 1) return { lead: null, match: "ambiguous_company_postcode" };

  return { lead: null, match: "none" };
}

function newestPlanByLead(orders, maps) {
  const plansByLead = new Map();
  const unmatched = [];
  const skippedWithoutDate = [];

  for (const order of orders) {
    const date = orderDate(order);
    if (!date) {
      skippedWithoutDate.push({ order_id: order.id, number: order.number, status: order.status });
      continue;
    }

    const { lead, match } = findLeadForOrder(order, maps);
    if (!lead) {
      unmatched.push({
        order_id: order.id,
        number: order.number,
        status: order.status,
        date,
        billing_email: normalizeEmail(order.billing?.email),
        billing_company: order.billing?.company || "",
        billing_postcode: order.billing?.postcode || "",
        match,
      });
      continue;
    }

    const existing = plansByLead.get(lead.id);
    const incomingTime = new Date(date).getTime();
    const existingPlanTime = existing ? new Date(existing.last_order_at).getTime() : 0;
    if (!existing || incomingTime > existingPlanTime) {
      plansByLead.set(lead.id, {
        lead_id: lead.id,
        company_name: lead.company_name,
        previous_last_order_at: lead.last_order_at,
        last_order_at: date,
        match,
        source_order: {
          order_id: order.id,
          number: order.number,
          status: order.status,
          date,
          billing_email: normalizeEmail(order.billing?.email),
          billing_company: order.billing?.company || "",
        },
      });
    }
  }

  return { plans: [...plansByLead.values()], unmatched, skippedWithoutDate };
}

function sameInstant(a, b) {
  if (!a || !b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  return !Number.isNaN(left) && left === right;
}

function buildOperations(leads, plans) {
  const plannedLeadIds = new Set(plans.map((plan) => plan.lead_id));
  const updates = plans
    .filter((plan) => !sameInstant(plan.previous_last_order_at, plan.last_order_at))
    .sort((a, b) => b.last_order_at.localeCompare(a.last_order_at) || a.company_name.localeCompare(b.company_name));

  const clears = clearMissing
    ? leads
        .filter((lead) => lead.last_order_at && !plannedLeadIds.has(lead.id))
        .map((lead) => ({
          lead_id: lead.id,
          company_name: lead.company_name,
          previous_last_order_at: lead.last_order_at,
          last_order_at: null,
          reason: "no_matching_woocommerce_order",
        }))
        .sort((a, b) => String(a.company_name || "").localeCompare(String(b.company_name || "")))
    : [];

  return {
    updates: updates.slice(0, limit > 0 ? limit : undefined),
    clears: clears.slice(0, limit > 0 ? limit : undefined),
  };
}

function reportSignature(report) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      tenant: report.tenant,
      source: report.source,
      clear_missing: report.clear_missing,
      planned_updates: report.planned_updates,
      planned_clears: report.planned_clears,
      updates: report.updates,
      clears: report.clears,
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

async function applyOperations(supabase, updates, clears) {
  const now = new Date().toISOString();
  for (const update of updates) {
    const { error } = await supabase
      .from("leads")
      .update({ last_order_at: update.last_order_at, updated_at: now })
      .eq("tenant", TENANT)
      .eq("id", update.lead_id);
    if (error) throw new Error(`${update.company_name}: ${error.message}`);
  }
  for (const clear of clears) {
    const { error } = await supabase
      .from("leads")
      .update({ last_order_at: null, updated_at: now })
      .eq("tenant", TENANT)
      .eq("id", clear.lead_id);
    if (error) throw new Error(`${clear.company_name}: ${error.message}`);
  }
}

async function main() {
  loadEnv();
  if (limit > 0 && clearMissing) {
    throw new Error("--limit kan niet samen met --clear-missing; dat zou een gedeeltelijke opschoning geven.");
  }

  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ orders, perStatus }, leads, contacts] = await Promise.all([
    fetchWooOrders(),
    fetchAllRows(
      () => supabase
        .from("leads")
        .select("id, tenant, company_name, email, billing_postal_code, delivery_postal_code, last_order_at")
        .eq("tenant", TENANT)
        .order("id", { ascending: true }),
      "HipHot leads"
    ),
    fetchAllRows(
      () => supabase
        .from("contacts")
        .select("id, tenant, lead_id, email")
        .eq("tenant", TENANT)
        .order("id", { ascending: true }),
      "HipHot contacten"
    ),
  ]);

  const maps = buildLeadMaps(leads, contacts);
  const { plans, unmatched, skippedWithoutDate } = newestPlanByLead(orders, maps);
  const { updates, clears } = buildOperations(leads, plans);
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentAfter = new Set(plans.filter((plan) => new Date(plan.last_order_at).getTime() >= recentCutoff).map((plan) => plan.lead_id));

  const report = {
    mode: DRY ? "dry-run" : "commit",
    tenant: TENANT,
    generated_at: new Date().toISOString(),
    source: {
      system: "woocommerce",
      statuses,
      per_status: perStatus,
      order_count: orders.length,
      lead_count: leads.length,
      contact_count: contacts.length,
      limit: limit || null,
    },
    clear_missing: clearMissing,
    matched_companies_with_order: plans.length,
    planned_updates: updates.length,
    planned_clears: clears.length,
    recent_order_14_days_after: recentAfter.size,
    unmatched_orders: unmatched.length,
    skipped_without_date: skippedWithoutDate.length,
    updates,
    clears,
    unmatched_samples: unmatched.slice(0, 25),
    skipped_without_date_samples: skippedWithoutDate.slice(0, 25),
  };

  if (!DRY) {
    const approved = loadApprovedReport();
    const expectedSignature = reportSignature({ ...approved, mode: "dry-run" });
    if (!approved.approval_signature || approved.approval_signature !== expectedSignature) {
      throw new Error("Goedgekeurd rapport heeft geen geldige approval_signature.");
    }
    if (approved.approval_signature !== reportSignature({ ...report, mode: "dry-run" })) {
      throw new Error("Het huidige WooCommerce/Supabase-plan wijkt af van de dry-run. Draai eerst opnieuw dry-run.");
    }
    await applyOperations(supabase, updates, clears);
  }

  writeReport(report);
  console.log(`HipHot last_order_at WooCommerce backfill ${report.mode}`);
  console.log(`WooCommerce orders: ${report.source.order_count}`);
  console.log(`Gematchte bedrijven met order: ${report.matched_companies_with_order}`);
  console.log(`Te updaten bedrijven: ${report.planned_updates}`);
  console.log(`Te wissen oude last_order_at waarden: ${report.planned_clears}`);
  console.log(`Recent besteld binnen 14 dagen na correctie: ${report.recent_order_14_days_after}`);
  console.log(`Rapport: ${reportPath}`);
  if (DRY) console.log(`Approval signature: ${report.approval_signature}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

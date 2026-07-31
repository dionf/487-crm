#!/usr/bin/env node
/**
 * Read-only verification for the HipHot HubSpot import.
 *
 * This script is hardcoded to tenant "hiphot" and never writes data.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const DEFAULT_REPORT = "/tmp/hiphot-hubspot-post-import-verification.json";
const args = process.argv.slice(2);
const reportPath = argValue("--report") || DEFAULT_REPORT;
const markdownReportPath = argValue("--report-md");
const expectedPath = argValue("--expected");

function argValue(name) {
  const match = args.find((a) => a.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readExpectedReport() {
  if (!expectedPath) return null;
  if (!fs.existsSync(expectedPath)) throw new Error(`Expected report niet gevonden: ${expectedPath}`);
  return JSON.parse(fs.readFileSync(expectedPath, "utf8"));
}

async function fetchAllPages(queryBuilder, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder.range(from, to);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("nl-NL");
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_Geen gegevens._";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function compareExpected(expected, actual) {
  if (!expected?.planned) return [];
  const checks = [
    ["bedrijven met HubSpot company ID", expected.planned.groups, actual.importedLeads],
    ["contactpersonen met HubSpot contact ID", expected.planned.contactsPlanned, actual.importedContacts],
    ["bedrijven met Factor 30", expected.planned.factor30Companies, actual.factor30Leads],
    ["bedrijven met Factor 50", expected.planned.factor50Companies, actual.factor50Leads],
    ["bedrijven met marketing toegestaan", expected.planned.marketingAllowedCompanies, actual.marketingConsentLeads],
  ];
  for (const [type, expectedValue] of Object.entries(expected.planned.relationshipTypes || {})) {
    checks.push([`bedrijven met relatietype ${type}`, expectedValue, actual.relationshipTypeCounts[type] || 0]);
  }
  return checks.map(([label, expectedValue, actualValue]) => ({
    label,
    expected: expectedValue,
    actual: actualValue,
    ok: Number(actualValue || 0) >= Number(expectedValue || 0),
  }));
}

function renderMarkdownReport(report) {
  const lines = [
    "# HipHot HubSpot post-import verificatie",
    "",
    `Datum: ${new Date().toISOString().slice(0, 10)}`,
    `Tenant: ${report.tenant}`,
    "",
    "## Aantallen",
    "",
    `HipHot bedrijven totaal: ${formatCount(report.counts.totalLeads)}`,
    `HubSpot bedrijven herkend: ${formatCount(report.counts.importedLeads)}`,
    `HubSpot contactpersonen herkend: ${formatCount(report.counts.importedContacts)}`,
    `Bedrijven met marketing toegestaan: ${formatCount(report.counts.marketingConsentLeads)}`,
    `Bedrijven met Factor 30: ${formatCount(report.counts.factor30Leads)}`,
    `Bedrijven met Factor 50: ${formatCount(report.counts.factor50Leads)}`,
    `HubSpot importactiviteiten: ${formatCount(report.counts.hubspotActivities)}`,
    `HubSpot importnotities: ${formatCount(report.counts.hubspotNotes)}`,
    "",
    "## Relatietypes",
    "",
    markdownTable(
      ["Relatietype", "Aantal"],
      Object.entries(report.relationshipTypeCounts).map(([type, count]) => [type, formatCount(count)])
    ),
    "",
    "## Marketingstatussen",
    "",
    markdownTable(
      ["Status", "Aantal"],
      Object.entries(report.marketingStatusCounts).map(([status, count]) => [status, formatCount(count)])
    ),
    "",
    "## Steekproef bedrijven",
    "",
    markdownTable(
      ["Bedrijf", "Relatietype", "Marketing", "Segmenten", "HubSpot company ID"],
      report.samples.leads.map((lead) => [
        lead.company_name,
        lead.relationship_type || "",
        lead.marketing_consent ? "Ja" : "Nee",
        (lead.marketing_segments || []).join(", "),
        lead.hubspot_company_id || "",
      ])
    ),
    "",
    "## Waarschuwingen",
    "",
    `Records buiten HipHot met HubSpot-markering: ${formatCount(report.warnings.nonHipHotHubspotMarkedLeads)}`,
    `Contacten buiten HipHot met HubSpot-markering: ${formatCount(report.warnings.nonHipHotHubspotMarkedContacts)}`,
    ""
  ];

  if (report.expectedComparisons.length) {
    lines.push(
      "## Vergelijking met importrapport",
      "",
      markdownTable(
        ["Controle", "Verwacht", "Live", "OK"],
        report.expectedComparisons.map((item) => [
          item.label,
          formatCount(item.expected),
          formatCount(item.actual),
          item.ok ? "Ja" : "Nee",
        ])
      ),
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (markdownReportPath) {
    fs.mkdirSync(path.dirname(markdownReportPath), { recursive: true });
    fs.writeFileSync(markdownReportPath, renderMarkdownReport(report));
  }
}

async function main() {
  console.log("\nHipHot HubSpot post-import verificatie");
  console.log(`Tenant: ${TENANT}`);
  console.log(`Rapport: ${reportPath}`);
  if (markdownReportPath) console.log(`Leesbaar rapport: ${markdownReportPath}`);

  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials ontbreken. Check .env.local.");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const expected = readExpectedReport();

  const [
    hiphotLeads,
    hiphotContacts,
    hiphotActivities,
    hiphotNotes,
    nonHipHotLeads,
    nonHipHotContacts,
  ] = await Promise.all([
    fetchAllPages(
      supabase
        .from("leads")
        .select("id, company_name, relationship_type, marketing_consent, marketing_segments, marketing_subscription_status, hubspot_company_id, hubspot_contact_ids, hubspot_imported_at")
        .eq("tenant", TENANT)
        .order("company_name", { ascending: true })
    ),
    fetchAllPages(
      supabase
        .from("contacts")
        .select("id, lead_id, name, email, hubspot_contact_id, hubspot_imported_at")
        .eq("tenant", TENANT)
        .order("created_at", { ascending: false })
    ),
    fetchAllPages(
      supabase
        .from("activities")
        .select("id, lead_id, activity_type, created_at")
        .eq("tenant", TENANT)
        .eq("activity_type", "hubspot_import")
    ),
    fetchAllPages(
      supabase
        .from("notes")
        .select("id, lead_id, content, created_at")
        .eq("tenant", TENANT)
        .ilike("content", "HubSpot%")
    ),
    fetchAllPages(
      supabase
        .from("leads")
        .select("id, tenant, hubspot_company_id")
        .neq("tenant", TENANT)
        .not("hubspot_company_id", "is", null)
    ),
    fetchAllPages(
      supabase
        .from("contacts")
        .select("id, tenant, hubspot_contact_id")
        .neq("tenant", TENANT)
        .not("hubspot_contact_id", "is", null)
    ),
  ]);

  const importedLeads = hiphotLeads.filter((lead) => lead.hubspot_company_id || lead.hubspot_imported_at);
  const importedContacts = hiphotContacts.filter((contact) => contact.hubspot_contact_id || contact.hubspot_imported_at);
  const factor30Leads = hiphotLeads.filter((lead) => (lead.marketing_segments || []).includes("factor_30"));
  const factor50Leads = hiphotLeads.filter((lead) => (lead.marketing_segments || []).includes("factor_50"));
  const marketingConsentLeads = hiphotLeads.filter((lead) => lead.marketing_consent);
  const relationshipTypeCounts = countBy(importedLeads, (lead) => lead.relationship_type || "unknown");
  const counts = {
    totalLeads: hiphotLeads.length,
    importedLeads: importedLeads.length,
    importedContacts: importedContacts.length,
    factor30Leads: factor30Leads.length,
    factor50Leads: factor50Leads.length,
    marketingConsentLeads: marketingConsentLeads.length,
    hubspotActivities: hiphotActivities.length,
    hubspotNotes: hiphotNotes.length,
  };
  const actualForExpectedComparison = {
    ...counts,
    relationshipTypeCounts,
  };

  const report = {
    mode: "post-import-verification",
    tenant: TENANT,
    generatedAt: new Date().toISOString(),
    expectedReportPath: expectedPath || null,
    counts,
    relationshipTypeCounts,
    marketingStatusCounts: countBy(hiphotLeads, (lead) => lead.marketing_subscription_status || "unknown"),
    expectedComparisons: compareExpected(expected, actualForExpectedComparison),
    samples: {
      leads: importedLeads.slice(0, 20),
      factor30: factor30Leads.slice(0, 10),
      factor50: factor50Leads.slice(0, 10),
      contacts: importedContacts.slice(0, 20),
    },
    warnings: {
      nonHipHotHubspotMarkedLeads: nonHipHotLeads.length,
      nonHipHotHubspotMarkedContacts: nonHipHotContacts.length,
    },
  };

  writeReports(report);
  console.log(`HipHot bedrijven totaal: ${counts.totalLeads}`);
  console.log(`HubSpot bedrijven herkend: ${counts.importedLeads}`);
  console.log(`HubSpot contactpersonen herkend: ${counts.importedContacts}`);
  console.log(`Factor 30 bedrijven: ${counts.factor30Leads}`);
  console.log(`Factor 50 bedrijven: ${counts.factor50Leads}`);
  console.log(`Relatietypes: ${Object.entries(report.relationshipTypeCounts).map(([type, count]) => `${type} ${count}`).join(", ") || "geen"}`);
  console.log(`Records buiten HipHot met HubSpot-markering: ${report.warnings.nonHipHotHubspotMarkedLeads}`);
  console.log(`Contacten buiten HipHot met HubSpot-markering: ${report.warnings.nonHipHotHubspotMarkedContacts}`);
}

main().catch((error) => {
  console.error(`Fout: ${error.message}`);
  process.exit(1);
});

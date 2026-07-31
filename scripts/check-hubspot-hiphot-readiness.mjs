#!/usr/bin/env node
/**
 * Read-only readiness check for the HipHot HubSpot import.
 *
 * This script is hardcoded to tenant "hiphot" and never writes data.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const DEFAULT_REPORT = "/tmp/hiphot-hubspot-readiness.json";
const args = process.argv.slice(2);
const reportPath = argValue("--report") || DEFAULT_REPORT;
const markdownReportPath = argValue("--report-md");

const CHECKS = [
  {
    id: "leads_hubspot_marketing_columns",
    label: "Leadvelden voor HubSpot en marketing",
    table: "leads",
    select: [
      "id",
      "tenant",
      "status",
      "marketing_consent",
      "marketing_segments",
      "marketing_subscription_status",
      "marketing_consent_source",
      "marketing_consent_date",
      "marketing_unsubscribed_at",
      "marketing_hard_bounced",
      "hubspot_company_id",
      "hubspot_contact_ids",
      "hubspot_imported_at",
      "hubspot_subscription_status",
    ].join(", "),
  },
  {
    id: "leads_relationship_type_column",
    label: "Leadveld Relatietype",
    table: "leads",
    select: "id, tenant, relationship_type",
  },
  {
    id: "contacts_hubspot_metadata_columns",
    label: "Contactvelden voor HubSpot metadata",
    table: "contacts",
    select: "id, tenant, lead_id, email, hubspot_contact_id, hubspot_imported_at",
  },
  {
    id: "notes_tenant_columns",
    label: "Notities tenantveilig leesbaar",
    table: "notes",
    select: "id, tenant, lead_id, content",
  },
  {
    id: "activities_tenant_columns",
    label: "Activiteiten tenantveilig leesbaar",
    table: "activities",
    select: "id, tenant, lead_id, activity_type",
  },
];

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

function summarizeError(error) {
  if (!error) return "";
  return [error.message, error.details, error.hint].filter(Boolean).join(" ");
}

async function runColumnCheck(supabase, check) {
  const { error } = await supabase
    .from(check.table)
    .select(check.select)
    .eq("tenant", TENANT)
    .limit(1);

  return {
    id: check.id,
    label: check.label,
    table: check.table,
    ok: !error,
    error: error ? summarizeError(error) : null,
  };
}

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw new Error(summarizeError(error));
  return count || 0;
}

async function runTenantChecks(supabase) {
  const checks = [];
  const totalHiphotLeads = await countRows(
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant", TENANT)
  );
  checks.push({
    id: "hiphot_leads_readable",
    label: "HipHot leads leesbaar",
    ok: totalHiphotLeads >= 0,
    value: totalHiphotLeads,
  });

  const nonHiphotHubspotLeads = await countRows(
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .neq("tenant", TENANT)
      .not("hubspot_company_id", "is", null)
  );
  checks.push({
    id: "no_non_hiphot_hubspot_leads",
    label: "Geen HubSpot company-ID buiten HipHot",
    ok: nonHiphotHubspotLeads === 0,
    value: nonHiphotHubspotLeads,
  });

  const nonHiphotHubspotContacts = await countRows(
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .neq("tenant", TENANT)
      .not("hubspot_contact_id", "is", null)
  );
  checks.push({
    id: "no_non_hiphot_hubspot_contacts",
    label: "Geen HubSpot contact-ID buiten HipHot",
    ok: nonHiphotHubspotContacts === 0,
    value: nonHiphotHubspotContacts,
  });

  return checks;
}

function renderMarkdownReport(report) {
  const lines = [
    "# HipHot HubSpot import readiness",
    "",
    `Datum: ${new Date(report.generatedAt).toISOString().slice(0, 10)}`,
    `Tenant: ${report.tenant}`,
    `Status: ${report.ready ? "Klaar voor dry-run/live-importstap" : "Niet klaar"}`,
    "",
    "## Schema",
    "",
    markdownTable(
      ["Controle", "Tabel", "OK", "Melding"],
      report.schemaChecks.map((check) => [
        check.label,
        check.table,
        check.ok ? "Ja" : "Nee",
        check.error || "",
      ])
    ),
    "",
    "## Tenantveiligheid",
    "",
    markdownTable(
      ["Controle", "Waarde", "OK"],
      report.tenantChecks.map((check) => [
        check.label,
        formatCount(check.value),
        check.ok ? "Ja" : "Nee",
      ])
    ),
    ""
  ];

  if (!report.ready) {
    lines.push(
      "## Actie nodig",
      "",
      "Pas ontbrekende CRM-migraties toe, met name `migrations/013_hiphot_company_marketing_segments.sql`, `migrations/014_hiphot_hubspot_contact_metadata.sql` en `migrations/015_hiphot_relationship_type.sql`, en draai daarna deze check opnieuw.",
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
  console.log("\nHipHot HubSpot import readiness");
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
  const schemaChecks = [];
  for (const check of CHECKS) {
    schemaChecks.push(await runColumnCheck(supabase, check));
  }

  let tenantChecks = [];
  let tenantCheckError = null;
  try {
    tenantChecks = await runTenantChecks(supabase);
  } catch (error) {
    tenantCheckError = error.message;
  }

  const ready = schemaChecks.every((check) => check.ok)
    && !tenantCheckError
    && tenantChecks.every((check) => check.ok);

  const report = {
    mode: "readiness",
    tenant: TENANT,
    generatedAt: new Date().toISOString(),
    ready,
    schemaChecks,
    tenantChecks,
    tenantCheckError,
  };

  writeReports(report);

  for (const check of schemaChecks) {
    console.log(`${check.ok ? "OK" : "MIST"} - ${check.label}`);
    if (check.error) console.log(`  ${check.error}`);
  }
  for (const check of tenantChecks) {
    console.log(`${check.ok ? "OK" : "LET OP"} - ${check.label}: ${check.value}`);
  }
  if (tenantCheckError) console.log(`LET OP - tenantchecks konden niet volledig draaien: ${tenantCheckError}`);
  if (!ready) {
    console.log("Readiness: niet klaar voor live import.");
    process.exit(1);
  }
  console.log("Readiness: klaar voor de volgende importstap.");
}

main().catch((error) => {
  console.error(`Fout: ${error.message}`);
  process.exit(1);
});

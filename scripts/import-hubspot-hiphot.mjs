#!/usr/bin/env node
/**
 * HubSpot -> HipHot CRM import.
 *
 * Default is a dry-run. Use --commit only with --approved-report after review.
 *
 * Examples:
 *   node scripts/import-hubspot-hiphot.mjs \
 *     --companies=/path/hubspot-companies.xlsx \
 *     --contacts=/path/hubspot-contacts.xlsx \
 *     --report=/tmp/hiphot-hubspot-import-report.json
 *
 *   node scripts/import-hubspot-hiphot.mjs \
 *     --contacts=/path/contacts.csv \
 *     --approved-report=/tmp/approved-dry-run.json \
 *     --commit
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const SOURCE = "hubspot";
const IMPORT_USER = "HubSpot import";
const DEFAULT_REPORT = "/tmp/hiphot-hubspot-import-report.json";
const HUBSPOT_IMPORT_MARKER = "HubSpot import key:";
const HIPHOT_MARKETING_SEGMENTS = [
  { id: "algemene_nieuwsbrief", label: "Algemene nieuwsbrief" },
  { id: "factor_30", label: "Factor 30" },
  { id: "factor_50", label: "Factor 50" },
  { id: "klant", label: "Klant" },
  { id: "prospect", label: "Prospect" },
  { id: "event_recreatie", label: "Event/recreatie" },
  { id: "outdoor_werk", label: "Outdoor werk" },
];
const HIPHOT_MARKETING_STATUSES = [
  { id: "unknown", label: "Onbekend" },
  { id: "subscribed", label: "Ingeschreven" },
  { id: "unsubscribed", label: "Uitgeschreven" },
  { id: "hard_bounce", label: "Hard bounce" },
  { id: "non_marketing", label: "Geen marketingcontact" },
];

const args = process.argv.slice(2);
const AUDIT = args.includes("--audit");
const DRY = args.includes("--dry-run") || !args.includes("--commit");
const OVERWRITE = args.includes("--overwrite");
const companiesPath = argValue("--companies");
const contactsPath = argValue("--contacts");
const dealsPath = argValue("--deals");
const notesPath = argValue("--notes");
const listsPath = argValue("--lists") || argValue("--lists-dir");
const listArgs = args.filter((arg) => arg.startsWith("--list=")).map((arg) => arg.slice("--list=".length));
const reportPath = argValue("--report") || DEFAULT_REPORT;
const markdownReportPath = argValue("--report-md");
const approvedReportPath = argValue("--approved-report") || argValue("--approved-dry-run");
const limit = Number(argValue("--limit") || 0);

const MARKETING_SEGMENT_IDS = new Set(HIPHOT_MARKETING_SEGMENTS.map((s) => s.id));
const MARKETING_STATUS_IDS = new Set(HIPHOT_MARKETING_STATUSES.map((s) => s.id));
const SEGMENT_PATTERNS = [
  { id: "factor_30", patterns: [/factor[\s_-]*30/i, /spf[\s_-]*30/i] },
  { id: "factor_50", patterns: [/factor[\s_-]*50/i, /spf[\s_-]*50/i] },
  { id: "algemene_nieuwsbrief", patterns: [/algemene nieuwsbrief/i, /newsletter/i, /nieuwsbrief/i] },
  { id: "klant", patterns: [/klant/i, /customer/i] },
  { id: "prospect", patterns: [/prospect/i, /lead/i] },
  { id: "event_recreatie", patterns: [/event/i, /recreatie/i] },
  { id: "outdoor_werk", patterns: [/outdoor/i, /bouw/i, /werk/i] },
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

function readRows(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    throw new Error(`Bestand niet gevonden: ${filePath}`);
  }
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function readableDataFile(filePath) {
  return /\.(csv|xlsx|xls)$/i.test(filePath) && !path.basename(filePath).startsWith(".");
}

function segmentIdFromText(value) {
  const matches = segmentMatchesFor(value);
  return matches.find((id) => MARKETING_SEGMENT_IDS.has(id)) || null;
}

function readListExports() {
  const specs = [];
  if (listsPath) {
    if (!fs.existsSync(listsPath)) {
      throw new Error(`Lijstmap niet gevonden: ${listsPath}`);
    }
    for (const fileName of fs.readdirSync(listsPath)) {
      const filePath = path.join(listsPath, fileName);
      if (fs.statSync(filePath).isFile() && readableDataFile(filePath)) {
        specs.push({ filePath, segmentId: segmentIdFromText(fileName), source: "directory" });
      }
    }
  }
  for (const spec of listArgs) {
    const separator = spec.indexOf(":");
    const firstPart = separator > 0 ? spec.slice(0, separator) : "";
    const filePath = separator > 0 && MARKETING_SEGMENT_IDS.has(firstPart)
      ? spec.slice(separator + 1)
      : spec;
    const segmentId = separator > 0 && MARKETING_SEGMENT_IDS.has(firstPart)
      ? firstPart
      : segmentIdFromText(path.basename(filePath));
    specs.push({ filePath, segmentId, source: "argument" });
  }

  return specs.map((spec) => {
    const rows = readRows(spec.filePath);
    return {
      ...spec,
      rows,
      fileName: path.basename(spec.filePath),
      segmentLabel: HIPHOT_MARKETING_SEGMENTS.find((segment) => segment.id === spec.segmentId)?.label || null,
    };
  });
}

function associationKey({ hubspotCompanyId, associatedCompanyId, companyName, domain, email }) {
  const companyId = hubspotCompanyId || associatedCompanyId;
  if (companyId) return `company:${companyId}`;
  if (domain) return `domain:${lower(domain)}`;
  if (companyName) return `name:${lower(companyName)}`;
  if (email) return `email:${lower(email)}`;
  return "";
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

function normalizeEmail(value) {
  const cleaned = lower(value);
  if (!cleaned) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : null;
}

function normalizePhone(value) {
  const cleaned = text(value).replace(/[^\d+]/g, "");
  return cleaned || null;
}

function normalizeUrl(value) {
  let cleaned = text(value);
  if (!cleaned) return null;
  if (!/^https?:\/\//i.test(cleaned)) cleaned = `https://${cleaned.replace(/^\/+/, "")}`;
  return cleaned;
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function splitMulti(value) {
  return text(value)
    .split(/[;,|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    const cleaned = text(value);
    if (!cleaned) continue;
    counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

function columnSummary(rows) {
  const columns = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key === "__index") continue;
      const existing = columns.get(key) || { name: key, nonEmpty: 0, samples: [] };
      if (text(value)) {
        existing.nonEmpty++;
        if (existing.samples.length < 3 && !existing.samples.includes(text(value))) {
          existing.samples.push(text(value));
        }
      }
      columns.set(key, existing);
    }
  }
  return [...columns.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isMarketingColumn(name) {
  return /list|tag|segment|subscription|marketing|newsletter|nieuwsbrief|factor|opt|bounce|unsubscribe|uitschrijf|afmeld/i.test(name);
}

function segmentMatchesFor(value) {
  const matches = [];
  for (const segment of SEGMENT_PATTERNS) {
    if (segment.patterns.some((pattern) => pattern.test(value))) {
      matches.push(segment.id);
    }
  }
  return matches;
}

function auditMarketingValues(rows) {
  const marketingColumns = columnSummary(rows).filter((column) => isMarketingColumn(column.name));
  const values = [];
  const recognizedSegments = new Map();
  const unrecognizedValues = [];

  for (const row of rows) {
    for (const column of marketingColumns) {
      const raw = row[column.name];
      for (const item of splitMulti(raw)) {
        values.push(`${column.name}: ${item}`);
        const matches = segmentMatchesFor(`${column.name}: ${item}`);
        if (matches.length) {
          for (const id of matches) {
            recognizedSegments.set(id, (recognizedSegments.get(id) || 0) + 1);
          }
        } else if (!/true|false|yes|no|ja|nee|0|1|subscribed|unsubscribed|marketing contact|non.?marketing|hard bounce|opted out|uitgeschreven|afgemeld/i.test(item)) {
          unrecognizedValues.push(`${column.name}: ${item}`);
        }
      }
    }
  }

  return {
    marketingColumns,
    topValues: countBy(values).slice(0, 100),
    recognizedSegments: [...recognizedSegments.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([segmentId, count]) => ({ segmentId, count })),
    possibleUnmappedSegmentValues: countBy(unrecognizedValues).slice(0, 100),
  };
}

function buildAuditReport({ companyRows, contactRows, dealRows, noteRows, listExports }) {
  return {
    mode: "audit",
    tenant: TENANT,
    input: {
      companiesPath,
      contactsPath,
      dealsPath,
      notesPath,
      listsPath,
      listArgs,
      companyRows: companyRows.length,
      contactRows: contactRows.length,
      dealRows: dealRows.length,
      noteRows: noteRows.length,
      listFiles: listExports.length,
      listRows: listExports.reduce((sum, listExport) => sum + listExport.rows.length, 0),
    },
    companies: {
      columns: columnSummary(companyRows),
    },
    contacts: {
      columns: columnSummary(contactRows),
      marketing: auditMarketingValues(contactRows),
    },
    deals: {
      columns: columnSummary(dealRows),
    },
    notes: {
      columns: columnSummary(noteRows),
    },
    lists: listExports.map((listExport) => ({
      filePath: listExport.filePath,
      fileName: listExport.fileName,
      rows: listExport.rows.length,
      segmentId: listExport.segmentId,
      segmentLabel: listExport.segmentLabel,
      source: listExport.source,
      columns: columnSummary(listExport.rows),
      marketing: auditMarketingValues(listExport.rows),
      needsManualMapping: !listExport.segmentId,
    })),
    expectedSegments: HIPHOT_MARKETING_SEGMENTS,
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => text(value)) || "";
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function segmentLabel(segmentId) {
  return HIPHOT_MARKETING_SEGMENTS.find((segment) => segment.id === segmentId)?.label || segmentId;
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

function writeReports(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (markdownReportPath) {
    fs.mkdirSync(path.dirname(markdownReportPath), { recursive: true });
    fs.writeFileSync(markdownReportPath, renderMarkdownReport(report));
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableJson(item)])
    );
  }
  return value;
}

function stripVolatileImportFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileImportFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["hubspot_imported_at"].includes(key))
        .map(([key, item]) => [key, stripVolatileImportFields(item)])
    );
  }
  if (typeof value === "string") {
    return value.replace(/Geïmporteerd uit HubSpot op \d{4}-\d{2}-\d{2}\./g, "Geïmporteerd uit HubSpot op <import-date>.");
  }
  return value;
}

function importApprovalPlan(plans, maps) {
  const approvalMaps = cloneContactMaps(maps);
  return plans.map((plan) => {
    const leadKey = approvalLeadKey(plan);
    const contactOperations = plan.contacts.map((contact) => {
      const operation = resolveContactOperation(contact, leadKey, approvalMaps);
      applyResolvedContactOperation(operation, contact, leadKey, approvalMaps, { virtual: true });
      return operation;
    });
    return stableJson(stripVolatileImportFields({
      action: plan.action,
      existingLeadId: plan.existingLead?.id || null,
      lead: plan.lead,
      contactOperations,
      contacts: plan.contacts.map((contact) => ({
        hubspot_contact_id: contact.hubspot_contact_id,
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        role: contact.role,
        is_primary: contact.is_primary,
        tenant: contact.tenant,
        marketing_consent: contact.marketing_consent,
      })),
      associatedNotes: plan.associatedNotes.map((note) => ({
        type: note.type,
        importKey: note.importKey,
        content: note.content,
        date: note.date,
      })),
      noteContent: plan.noteContent,
      activityMetadata: {
        action: plan.action,
        associated_notes: plan.associatedNotes.length,
        source: SOURCE,
        raw: plan.raw,
      },
    }));
  });
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableJson(value)))
    .digest("hex");
}

function comparableImportSignature(report) {
  return {
    tenant: report.tenant,
    input: report.input,
    options: report.options,
    planned: report.planned,
    warnings: report.warnings,
    approval: report.approval,
    approvalPlan: report.approvalPlan,
  };
}

function assertApprovedDryRun(currentReport) {
  if (DRY || AUDIT) return;
  if (!approvedReportPath) {
    throw new Error("Live import vereist --approved-report=/pad/naar/goedgekeurde-dry-run.json.");
  }
  if (!fs.existsSync(approvedReportPath)) {
    throw new Error(`Goedgekeurde dry-run niet gevonden: ${approvedReportPath}`);
  }
  const approved = JSON.parse(fs.readFileSync(approvedReportPath, "utf8"));
  if (approved.mode !== "dry-run" || approved.tenant !== TENANT) {
    throw new Error("Approved report moet een dry-run rapport voor tenant hiphot zijn.");
  }
  const approvedSignature = JSON.stringify(comparableImportSignature(approved));
  const currentSignature = JSON.stringify(comparableImportSignature(currentReport));
  if (approvedSignature !== currentSignature) {
    throw new Error("Huidige importplanning wijkt af van het approved dry-run rapport. Draai en beoordeel eerst opnieuw een dry-run.");
  }
}

function renderMarkdownReport(report) {
  const lines = [
    `# HipHot HubSpot migratierapport`,
    "",
    `Datum: ${new Date().toISOString().slice(0, 10)}`,
    `Modus: ${report.mode}`,
    `Tenant: ${report.tenant}`,
    "",
  ];

  if (report.mode === "audit") {
    lines.push(
      "## Export-audit",
      "",
      `Bedrijvenrijen: ${formatCount(report.input.companyRows)}`,
      `Contactrijen: ${formatCount(report.input.contactRows)}`,
      `Dealrijen: ${formatCount(report.input.dealRows)}`,
      `Notitierijen: ${formatCount(report.input.noteRows)}`,
      `Losse lijstbestanden: ${formatCount(report.input.listFiles)}`,
      `Losse lijstrijen: ${formatCount(report.input.listRows)}`,
      "",
      "## Marketingkolommen",
      "",
      markdownTable(
        ["Kolom", "Gevulde rijen", "Voorbeelden"],
        report.contacts.marketing.marketingColumns.map((column) => [
          column.name,
          formatCount(column.nonEmpty),
          column.samples.join(", "),
        ])
      ),
      "",
      "## Herkende segmenten in contactexport",
      "",
      markdownTable(
        ["Segment", "Aantal hits"],
        report.contacts.marketing.recognizedSegments.map((item) => [
          segmentLabel(item.segmentId),
          formatCount(item.count),
        ])
      ),
      "",
      "## Losse lijstexports",
      "",
      markdownTable(
        ["Bestand", "Segment", "Rijen", "Actie"],
        report.lists.map((item) => [
          item.fileName,
          item.segmentLabel || "Onbekend",
          formatCount(item.rows),
          item.needsManualMapping ? "Mapping controleren" : "OK",
        ])
      ),
      "",
      "## Mogelijk nog te mappen waarden",
      "",
      markdownTable(
        ["Waarde", "Aantal"],
        report.contacts.marketing.possibleUnmappedSegmentValues.slice(0, 30).map((item) => [
          item.value,
          formatCount(item.count),
        ])
      )
    );
    if (report.deals.columns.length || report.notes.columns.length) {
      lines.push(
        "",
        "## Deals en notities",
        "",
        `Dealkolommen: ${formatCount(report.deals.columns.length)}`,
        `Notitiekolommen: ${formatCount(report.notes.columns.length)}`
      );
    }
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "## Samenvatting",
    "",
    `Bestaande HipHot bedrijven in CRM: ${formatCount(report.existing.leads)}`,
    `Bestaande HipHot contactpersonen in CRM: ${formatCount(report.existing.contacts)}`,
    `Bestaande CRM-velden overschrijven: ${report.options.overwrite ? "Ja" : "Nee"}`,
    `Importvingerafdruk: ${report.approval.mutationFingerprint}`,
    `Nieuwe bedrijven gepland: ${formatCount(report.planned.insertLeads)}`,
    `Bestaande bedrijven bijwerken: ${formatCount(report.planned.updateLeads)}`,
    `Contactpersonen uit HubSpot: ${formatCount(report.planned.contactsSeen)}`,
    `Contactpersonen uit losse lijsten: ${formatCount(report.planned.listContactsSeen)}`,
    `HubSpot deals als notitie: ${formatCount(report.planned.dealsSeen)}`,
    `HubSpot notities als notitie: ${formatCount(report.planned.notesSeen)}`,
    `Bedrijven met marketing toegestaan: ${formatCount(report.planned.marketingAllowedCompanies)}`,
    `Bedrijven in Algemene nieuwsbrief: ${formatCount(report.planned.algemeneNieuwsbriefCompanies)}`,
    `Bedrijven in Factor 30: ${formatCount(report.planned.factor30Companies)}`,
    `Bedrijven in Factor 50: ${formatCount(report.planned.factor50Companies)}`,
    "",
    "## Voorbeelden",
    "",
    markdownTable(
      ["Actie", "Bedrijf", "Marketing", "Segmenten", "Contacten", "Deals", "Notities"],
      report.samples.map((sample) => [
        sample.action === "insert_lead" ? "Nieuw" : "Bijwerken",
        sample.company,
        sample.marketingConsent ? "Ja" : "Nee",
        (sample.marketingSegments || []).map(segmentLabel).join(", "),
        sample.contacts.map((contact) => contact.email || contact.name).join(", "),
        sample.dealCount,
        sample.noteCount,
      ])
    ),
    "",
    "## Waarschuwingen",
    "",
    `Zonder bedrijfsnaam: ${formatCount(report.warnings.noCompanyName)}`,
    `Contacten met onbekende marketingstatus: ${formatCount(report.warnings.unknownMarketingStatusContacts)}`,
    `Contacten zonder herkend segment: ${formatCount(report.warnings.noRecognizedSegmentContacts)}`,
    `Niet gekoppelde deals: ${formatCount(report.warnings.unmatchedDeals)}`,
    `Niet gekoppelde notities: ${formatCount(report.warnings.unmatchedNotes)}`,
    `Lijstbestanden zonder segmentmapping: ${(report.warnings.listFilesWithoutSegmentMapping || []).join(", ") || "geen"}`,
    ""
  );

  if (report.commit) {
    lines.push(
      "## Importresultaat",
      "",
      `Gelukt: ${formatCount(report.commit.committed)}`,
      `Mislukt: ${formatCount(report.commit.failed)}`,
      `HubSpot notities toegevoegd: ${formatCount(report.commit.createdAssociatedNotes)}`,
      `HubSpot notities overgeslagen als duplicaat: ${formatCount(report.commit.skippedAssociatedNotes)}`,
      ""
    );
  } else {
    lines.push(
      "## Advies",
      "",
      "Dit was een dry-run. Controleer de aantallen en waarschuwingen voordat de import met `--commit` wordt uitgevoerd.",
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function cleanRawRow(row) {
  const copy = { ...row };
  delete copy.__index;
  return copy;
}

function cleanRawRows(rows) {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.__index;
    return copy;
  });
}

function parseCompany(row) {
  const hubspotCompanyId = text(get(row, [
    "Record ID",
    "Company ID",
    "HubSpot Company ID",
    "hs_object_id",
    "Company record ID",
  ]));
  const companyName = text(get(row, ["Company name", "Name", "Bedrijfsnaam", "Organisatie", "Company"]));
  const domain = lower(get(row, ["Company domain name", "Domain", "Domein", "Website domain"]));
  const city = text(get(row, ["City", "Plaats", "Stad"]));

  return {
    hubspotCompanyId,
    companyName,
    domain,
    lead: {
      tenant: TENANT,
      company_name: companyName,
      contact_person: "",
      contact_first_name: "",
      contact_last_name: "",
      email: normalizeEmail(get(row, ["Email", "Company email", "E-mail"])),
      phone: normalizePhone(get(row, ["Phone number", "Phone", "Telefoonnummer", "Telefoon"])),
      website_url: normalizeUrl(firstNonEmpty(
        get(row, ["Website URL", "Website", "Web URL"]),
        domain
      )),
      address: text(get(row, ["Street address", "Address", "Adres"])) || null,
      city: city || null,
      billing_street: text(get(row, ["Street address", "Address", "Adres"])) || null,
      billing_postal_code: text(get(row, ["Postal code", "Zip", "Postcode"])) || null,
      billing_city: city || null,
      billing_country: text(get(row, ["Country/Region", "Country", "Land"])) || "NL",
      delivery_same_as_billing: true,
      delivery_street: text(get(row, ["Street address", "Address", "Adres"])) || null,
      delivery_postal_code: text(get(row, ["Postal code", "Zip", "Postcode"])) || null,
      delivery_city: city || null,
      delivery_country: text(get(row, ["Country/Region", "Country", "Land"])) || "NL",
      industry: lower(get(row, ["Industry", "Branche"])) || null,
      source: SOURCE,
      status: "prospect",
      language: "nl",
      hubspot_company_id: hubspotCompanyId || null,
      hubspot_imported_at: new Date().toISOString(),
    },
    raw: row,
  };
}

function parseContact(row) {
  const firstName = text(get(row, ["First name", "Voornaam", "First Name"]));
  const lastName = text(get(row, ["Last name", "Achternaam", "Last Name"]));
  const fullName = text(firstNonEmpty(
    get(row, ["Name", "Full name", "Contact name", "Naam"]),
    `${firstName} ${lastName}`.trim()
  ));
  const companyName = text(get(row, ["Company name", "Associated company", "Associated Company", "Bedrijf", "Organisatie"]));
  const hubspotContactId = text(get(row, [
    "Record ID",
    "Contact ID",
    "HubSpot Contact ID",
    "hs_object_id",
    "Contact record ID",
  ]));
  const associatedCompanyId = text(get(row, [
    "Associated Company ID",
    "Associated company IDs",
    "Company ID",
    "Primary associated company ID",
    "Associated company record ID",
  ])).split(/[;,]/)[0]?.trim() || "";

  return {
    hubspotContactId,
    associatedCompanyId,
    companyName,
    domain: lower(get(row, ["Company domain name", "Domain", "Domein"])),
    email: normalizeEmail(get(row, ["Email", "E-mail", "E-mailadres"])),
    phone: normalizePhone(get(row, ["Phone number", "Phone", "Mobile phone number", "Telefoon", "Mobiel"])),
    role: text(get(row, ["Job title", "Functie", "Role", "Rol"])) || null,
    firstName,
    lastName,
    fullName,
    marketing: parseMarketing(row),
    raw: row,
  };
}

function parseListMember(listExport, row) {
  const firstName = text(get(row, ["First name", "Voornaam", "First Name"]));
  const lastName = text(get(row, ["Last name", "Achternaam", "Last Name"]));
  const email = normalizeEmail(get(row, ["Email", "E-mail", "E-mailadres"]));
  const fullName = text(firstNonEmpty(
    get(row, ["Name", "Full name", "Contact name", "Naam"]),
    `${firstName} ${lastName}`.trim()
  ));
  const companyName = text(get(row, ["Company name", "Associated company", "Associated Company", "Bedrijf", "Organisatie"]));
  const hubspotContactId = text(get(row, [
    "Record ID",
    "Contact ID",
    "HubSpot Contact ID",
    "hs_object_id",
    "Contact record ID",
  ]));
  const associatedCompanyId = text(get(row, [
    "Associated Company ID",
    "Associated company IDs",
    "Company ID",
    "Primary associated company ID",
    "Associated company record ID",
  ])).split(/[;,]/)[0]?.trim() || "";

  return {
    hubspotContactId,
    associatedCompanyId,
    companyName,
    domain: lower(get(row, ["Company domain name", "Domain", "Domein"])),
    email,
    phone: normalizePhone(get(row, ["Phone number", "Phone", "Mobile phone number", "Telefoon", "Mobiel"])),
    role: text(get(row, ["Job title", "Functie", "Role", "Rol"])) || null,
    firstName,
    lastName,
    fullName,
    marketing: {
      status: "subscribed",
      consent: true,
      hardBounce: false,
      unsubscribedAt: null,
      consentDate: null,
      source: `HubSpot list export: ${listExport.fileName}`,
      rawStatus: listExport.segmentLabel || listExport.fileName,
      segments: [listExport.segmentId].filter(Boolean),
    },
    raw: row,
  };
}

function parseDeal(row) {
  const dealId = text(get(row, ["Record ID", "Deal ID", "HubSpot Deal ID", "hs_object_id"]));
  const dealName = text(get(row, ["Deal name", "Deal Name", "Naam", "Dealnaam"]));
  const amount = text(get(row, ["Amount", "Bedrag", "Deal amount", "Value", "Waarde"]));
  const stage = text(get(row, ["Deal stage", "Stage", "Dealstadium", "Pipeline stage"]));
  const pipeline = text(get(row, ["Pipeline", "Pijplijn"]));
  const closeDate = text(get(row, ["Close date", "Closed date", "Sluitdatum"]));
  const createDate = text(get(row, ["Create date", "Created date", "Aanmaakdatum"]));
  const owner = text(get(row, ["Deal owner", "Owner", "Eigenaar"]));
  const associatedCompanyId = text(get(row, [
    "Associated Company ID",
    "Associated company IDs",
    "Company ID",
    "Primary associated company ID",
    "Associated company record ID",
  ])).split(/[;,]/)[0]?.trim() || "";
  const companyName = text(get(row, ["Company name", "Associated company", "Associated Company", "Bedrijf", "Organisatie"]));

  const importKey = dealId ? `hubspot-deal:${dealId}` : `hubspot-deal:${lower(companyName)}:${lower(dealName)}:${amount}:${closeDate}`;
  return {
    type: "deal",
    importKey,
    dealId,
    associatedCompanyId,
    companyName,
    domain: lower(get(row, ["Company domain name", "Domain", "Domein"])),
    email: normalizeEmail(get(row, ["Email", "Contact email", "Associated Contact Email", "E-mail", "E-mailadres"])),
    title: dealName || dealId || "HubSpot deal",
    date: cleanDate(closeDate || createDate),
    raw: row,
    content: [
      "HubSpot deal",
      `${HUBSPOT_IMPORT_MARKER} ${importKey}`,
      dealId ? `ID: ${dealId}` : null,
      dealName ? `Naam: ${dealName}` : null,
      stage ? `Status: ${stage}` : null,
      pipeline ? `Pipeline: ${pipeline}` : null,
      amount ? `Bedrag: ${amount}` : null,
      closeDate ? `Sluitdatum: ${closeDate}` : null,
      owner ? `Eigenaar: ${owner}` : null,
    ].filter(Boolean).join("\n"),
  };
}

function parseHubSpotNote(row) {
  const noteId = text(get(row, ["Record ID", "Note ID", "HubSpot Note ID", "hs_object_id"]));
  const body = text(get(row, ["Note body", "Body", "Content", "Notitie", "Note", "Description", "Omschrijving"]));
  const createDate = text(get(row, ["Create date", "Created date", "Activity date", "Timestamp", "Aanmaakdatum", "Datum"]));
  const owner = text(get(row, ["Note owner", "Owner", "Eigenaar", "Created by"]));
  const associatedCompanyId = text(get(row, [
    "Associated Company ID",
    "Associated company IDs",
    "Company ID",
    "Primary associated company ID",
    "Associated company record ID",
  ])).split(/[;,]/)[0]?.trim() || "";
  const companyName = text(get(row, ["Company name", "Associated company", "Associated Company", "Bedrijf", "Organisatie"]));

  const importKey = noteId ? `hubspot-note:${noteId}` : `hubspot-note:${lower(companyName)}:${createDate}:${body.slice(0, 80)}`;
  return {
    type: "note",
    importKey,
    noteId,
    associatedCompanyId,
    companyName,
    domain: lower(get(row, ["Company domain name", "Domain", "Domein"])),
    email: normalizeEmail(get(row, ["Email", "Contact email", "Associated Contact Email", "E-mail", "E-mailadres"])),
    title: noteId || "HubSpot notitie",
    date: cleanDate(createDate),
    raw: row,
    content: [
      "HubSpot notitie",
      `${HUBSPOT_IMPORT_MARKER} ${importKey}`,
      noteId ? `ID: ${noteId}` : null,
      createDate ? `Datum: ${createDate}` : null,
      owner ? `Eigenaar: ${owner}` : null,
      body ? "" : null,
      body || "(geen notitietekst in export)",
    ].filter((line) => line !== null).join("\n"),
  };
}

function attachAssociatedRecords(groups, records) {
  const byKey = new Map();
  for (const group of groups) {
    group.deals = group.deals || [];
    group.notes = group.notes || [];
    const keys = [
      associationKey({
        hubspotCompanyId: group.company.hubspotCompanyId,
        companyName: group.company.companyName,
        domain: group.company.domain,
        email: group.company.lead.email,
      }),
      ...group.contacts.map((contact) => associationKey({
        associatedCompanyId: contact.associatedCompanyId,
        companyName: contact.companyName,
        domain: contact.domain,
        email: contact.email,
      })),
    ].filter(Boolean);
    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, group);
    }
  }

  const unmatched = [];
  for (const record of records) {
    const key = associationKey(record);
    const group = key ? byKey.get(key) : null;
    if (!group) {
      unmatched.push(record);
      continue;
    }
    if (record.type === "deal") group.deals.push(record);
    if (record.type === "note") group.notes.push(record);
  }

  return unmatched;
}

function mergeMarketingRecords(a, b) {
  const priority = ["hard_bounce", "unsubscribed", "subscribed", "non_marketing", "unknown"];
  const statuses = [a.status, b.status].filter(Boolean);
  const status = priority.find((candidate) => statuses.includes(candidate)) || "unknown";
  const subscribedSource = [a, b].find((item) => item.status === "subscribed");
  const unsubscribedSource = [a, b].find((item) => item.status === "unsubscribed");
  return {
    status,
    consent: status === "subscribed",
    hardBounce: status === "hard_bounce",
    unsubscribedAt: unsubscribedSource?.unsubscribedAt || a.unsubscribedAt || b.unsubscribedAt || null,
    consentDate: subscribedSource?.consentDate || a.consentDate || b.consentDate || null,
    source: subscribedSource?.source || a.source || b.source || "HubSpot import",
    rawStatus: [a.rawStatus, b.rawStatus].filter(Boolean).join(" | ") || null,
    segments: [...new Set([...(a.segments || []), ...(b.segments || [])])],
  };
}

function mergeContactRecords(contacts) {
  const byKey = new Map();
  const keyFor = (contact) => {
    if (contact.hubspotContactId) return `hubspot:${contact.hubspotContactId}`;
    if (contact.email) return `email:${contact.email}`;
    if (contact.associatedCompanyId && contact.fullName) return `company:${contact.associatedCompanyId}|name:${lower(contact.fullName)}`;
    if (contact.companyName && contact.fullName) return `company-name:${lower(contact.companyName)}|name:${lower(contact.fullName)}`;
    return "";
  };

  for (const contact of contacts) {
    const key = keyFor(contact);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, contact);
      continue;
    }
    byKey.set(key, {
      ...existing,
      hubspotContactId: existing.hubspotContactId || contact.hubspotContactId,
      associatedCompanyId: existing.associatedCompanyId || contact.associatedCompanyId,
      companyName: existing.companyName || contact.companyName,
      domain: existing.domain || contact.domain,
      email: existing.email || contact.email,
      phone: existing.phone || contact.phone,
      role: existing.role || contact.role,
      firstName: existing.firstName || contact.firstName,
      lastName: existing.lastName || contact.lastName,
      fullName: existing.fullName || contact.fullName,
      marketing: mergeMarketingRecords(existing.marketing, contact.marketing),
      raw: {
        ...cleanRawRow(existing.raw),
        __merged_list_rows: [
          ...(existing.raw?.__merged_list_rows || []),
          cleanRawRow(contact.raw),
        ],
      },
    });
  }

  return [...byKey.values()];
}

function parseMarketing(row) {
  const haystackValues = [
    get(row, ["Marketing contact status", "Marketing status", "Marketing Contact"]),
    get(row, ["Email subscription status", "Subscription status", "Nieuwsbrief status"]),
    get(row, ["Opted out of email", "Unsubscribed from all email", "Uitgeschreven"]),
    get(row, ["Email hard bounce reason", "Hard bounce reason", "Hard bounce"]),
    get(row, ["List memberships", "Lists", "Tags", "Segmenten", "Tags/segmenten"]),
  ];
  const haystack = haystackValues.map(text).join(" | ");
  const hardBounce = /hard bounce|bounced|bounce/i.test(haystack);
  const unsubscribed = /unsubscribed|opted out|uitgeschreven|afgemeld/i.test(haystack);
  const nonMarketing = /non.?marketing|geen marketing|not a marketing contact/i.test(haystack);
  const subscribed = /subscribed|marketing contact|ingeschreven|nieuwsbrief/i.test(haystack) && !unsubscribed && !hardBounce && !nonMarketing;

  const segments = new Set();
  for (const [key, value] of Object.entries(row)) {
    const combined = `${key}: ${value}`;
    for (const segment of SEGMENT_PATTERNS) {
      if (segment.patterns.some((pattern) => pattern.test(combined))) {
        segments.add(segment.id);
      }
    }
  }

  return {
    status: hardBounce
      ? "hard_bounce"
      : unsubscribed
        ? "unsubscribed"
        : nonMarketing
          ? "non_marketing"
          : subscribed
            ? "subscribed"
            : "unknown",
    consent: subscribed,
    hardBounce,
    unsubscribedAt: unsubscribed ? cleanDate(get(row, ["Unsubscribed date", "Opt out date", "Afmelddatum"])) : null,
    consentDate: subscribed ? cleanDate(get(row, ["Marketing contact status source date", "Opt in date", "Inschrijfdatum", "Create date"])) : null,
    source: text(get(row, ["Marketing contact status source", "Subscription source", "Bron toestemming"])) || "HubSpot import",
    rawStatus: haystack || null,
    segments: [...segments].filter((id) => MARKETING_SEGMENT_IDS.has(id)),
  };
}

function mergeMarketing(company, contacts) {
  const statuses = contacts.map((contact) => contact.marketing.status);
  const segments = new Set(contacts.flatMap((contact) => contact.marketing.segments));
  const subscribed = contacts.find((contact) => contact.marketing.status === "subscribed");
  const hardBounces = contacts.filter((contact) => contact.marketing.status === "hard_bounce");
  const unsubscribed = contacts.find((contact) => contact.marketing.status === "unsubscribed");
  const nonMarketing = contacts.find((contact) => contact.marketing.status === "non_marketing");

  let status = "unknown";
  if (subscribed) status = "subscribed";
  else if (contacts.length > 0 && hardBounces.length === contacts.length) status = "hard_bounce";
  else if (unsubscribed) status = "unsubscribed";
  else if (nonMarketing) status = "non_marketing";

  return {
    marketing_consent: status === "subscribed",
    marketing_segments: [...segments],
    marketing_subscription_status: MARKETING_STATUS_IDS.has(status) ? status : "unknown",
    marketing_consent_source: subscribed?.marketing.source || "HubSpot import",
    marketing_consent_date: subscribed?.marketing.consentDate || null,
    marketing_unsubscribed_at: unsubscribed?.marketing.unsubscribedAt || null,
    marketing_hard_bounced: status === "hard_bounce",
    hubspot_subscription_status: statuses.filter((item) => item !== "unknown").join(", ") || null,
    hubspot_contact_ids: contacts.map((contact) => contact.hubspotContactId).filter(Boolean),
    hubspot_company_id: company.lead.hubspot_company_id || null,
    hubspot_imported_at: new Date().toISOString(),
  };
}

function groupRecords(companies, contacts) {
  const groups = new Map();

  for (const company of companies) {
    const key = associationKey(company);
    if (!key || !company.companyName) continue;
    groups.set(key, { company, contacts: [], deals: [], notes: [] });
  }

  for (const contact of contacts) {
    const key = associationKey({
      associatedCompanyId: contact.associatedCompanyId,
      companyName: contact.companyName,
      domain: contact.domain,
      email: contact.email,
    });
    if (!key) continue;
    if (!groups.has(key)) {
      const fallbackCompany = parseCompany({
        "Company name": contact.companyName || contact.email || contact.fullName,
        "Company ID": contact.associatedCompanyId,
        Email: contact.email || "",
        Phone: contact.phone || "",
      });
      fallbackCompany.domain = contact.domain;
      groups.set(key, { company: fallbackCompany, contacts: [], deals: [], notes: [] });
    }
    groups.get(key).contacts.push(contact);
  }

  return [...groups.values()]
    .filter((group) => group.company.companyName || group.contacts.length)
    .slice(0, limit > 0 ? limit : undefined);
}

function buildPlan(group, existingLead) {
  const primary = group.contacts.find((contact) => contact.email) || group.contacts[0];
  const lead = {
    ...group.company.lead,
    ...mergeMarketing(group.company, group.contacts),
  };

  if (primary) {
    lead.contact_first_name = primary.firstName || "";
    lead.contact_last_name = primary.lastName || "";
    lead.contact_person = primary.fullName || primary.email || "";
    lead.email = primary.email || lead.email || null;
    lead.phone = primary.phone || lead.phone || null;
    lead.contact_function = primary.role || null;
  }

  if (!lead.contact_person) lead.contact_person = lead.company_name;
  const action = existingLead ? "update_lead" : "insert_lead";
  const hasMarketingEvidence = group.contacts.some(
    (contact) => contact.marketing.status !== "unknown" || contact.marketing.segments.length > 0
  );
  return {
    action,
    existingLead,
    lead: existingLead ? patchForExistingLead(lead, existingLead, hasMarketingEvidence) : lead,
    contacts: group.contacts.map((contact, index) => ({
      hubspot_contact_id: contact.hubspotContactId || null,
      hubspot_imported_at: new Date().toISOString(),
      name: contact.fullName || contact.email || `HubSpot contact ${index + 1}`,
      email: contact.email,
      phone: contact.phone,
      role: contact.role,
      is_primary: index === 0,
      tenant: TENANT,
      marketing_consent: false,
    })),
    associatedNotes: [
      ...(group.deals || []).map((deal) => ({
        type: "deal",
        importKey: deal.importKey,
        content: deal.content,
        date: deal.date,
        raw: cleanRawRow(deal.raw),
      })),
      ...(group.notes || []).map((note) => ({
        type: "note",
        importKey: note.importKey,
        content: note.content,
        date: note.date,
        raw: cleanRawRow(note.raw),
      })),
    ],
    noteContent: buildNote(group),
    raw: {
      company: cleanRawRow(group.company.raw),
      contacts: cleanRawRows(group.contacts.map((contact) => contact.raw)),
    },
  };
}

function patchForExistingLead(incoming, existing, hasMarketingEvidence) {
  const alwaysUpdate = [
    "hubspot_company_id",
    "hubspot_contact_ids",
    "hubspot_imported_at",
  ];
  const marketingUpdate = [
    "marketing_consent",
    "marketing_segments",
    "marketing_subscription_status",
    "marketing_consent_source",
    "marketing_consent_date",
    "marketing_unsubscribed_at",
    "marketing_hard_bounced",
    "hubspot_subscription_status",
  ];
  const fillIfEmpty = [
    "email",
    "phone",
    "website_url",
    "address",
    "city",
    "billing_street",
    "billing_postal_code",
    "billing_city",
    "billing_country",
    "delivery_same_as_billing",
    "delivery_street",
    "delivery_postal_code",
    "delivery_city",
    "delivery_country",
    "industry",
    "contact_first_name",
    "contact_last_name",
    "contact_person",
    "contact_function",
    "language",
  ];

  const patch = {};
  for (const key of alwaysUpdate) patch[key] = incoming[key];
  if (hasMarketingEvidence) {
    for (const key of marketingUpdate) patch[key] = incoming[key];
  }
  for (const key of fillIfEmpty) {
    if (OVERWRITE || existing[key] === null || existing[key] === undefined || existing[key] === "") {
      patch[key] = incoming[key];
    }
  }
  return compactObject(patch);
}

function buildNote(group) {
  const lines = [
    `Geïmporteerd uit HubSpot op ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (group.company.hubspotCompanyId) lines.push(`HubSpot bedrijf-ID: ${group.company.hubspotCompanyId}`);
  if (group.contacts.length) lines.push(`Contactpersonen uit HubSpot: ${group.contacts.length}`);
  if (group.deals?.length) lines.push(`Deals uit HubSpot: ${group.deals.length}`);
  if (group.notes?.length) lines.push(`Notities uit HubSpot: ${group.notes.length}`);
  const segmentLabels = group.contacts.flatMap((contact) => contact.marketing.segments);
  if (segmentLabels.length) lines.push(`Marketingsegmenten: ${[...new Set(segmentLabels)].join(", ")}`);
  return lines.join("\n");
}

async function fetchExisting(supabase) {
  const [leads, contacts] = await Promise.all([
    fetchAllExistingRows(() => supabase
      .from("leads")
      .select("id, company_name, city, email, hubspot_company_id, marketing_segments, marketing_consent, contact_person, contact_first_name, contact_last_name, contact_function, phone, website_url, address, billing_street, billing_postal_code, billing_city, billing_country, delivery_same_as_billing, delivery_street, delivery_postal_code, delivery_city, delivery_country, industry, language")
      .eq("tenant", TENANT)
      .order("id", { ascending: true }), "bestaande HipHot leads"),
    fetchAllExistingRows(() => supabase
      .from("contacts")
      .select("id, lead_id, email, hubspot_contact_id")
      .eq("tenant", TENANT)
      .order("id", { ascending: true }), "bestaande HipHot contacten"),
  ]);
  return { leads, contacts };
}

async function fetchAllExistingRows(queryFactory, label) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory()
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Kon ${label} niet ophalen: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function findExistingLead(group, maps) {
  const company = group.company;
  if (company.hubspotCompanyId && maps.byHubspotCompanyId.has(company.hubspotCompanyId)) {
    return maps.byHubspotCompanyId.get(company.hubspotCompanyId);
  }
  const city = lower(company.lead.city);
  const name = lower(company.companyName);
  if (name && maps.byCompanyCity.has(`${name}|${city}`)) {
    return maps.byCompanyCity.get(`${name}|${city}`);
  }
  const firstEmail = group.contacts.find((contact) => contact.email)?.email || company.lead.email;
  if (firstEmail && maps.byLeadEmail.has(firstEmail)) {
    return maps.byLeadEmail.get(firstEmail);
  }
  return null;
}

function buildMaps(existing) {
  const byHubspotCompanyId = new Map();
  const byCompanyCity = new Map();
  const byLeadEmail = new Map();
  const contactsByEmailLead = new Map();
  const contactsByHubspotId = new Map();

  for (const lead of existing.leads) {
    if (lead.hubspot_company_id) byHubspotCompanyId.set(lead.hubspot_company_id, lead);
    byCompanyCity.set(`${lower(lead.company_name)}|${lower(lead.city)}`, lead);
    if (lead.email) byLeadEmail.set(lower(lead.email), lead);
  }
  for (const contact of existing.contacts) {
    if (contact.email) contactsByEmailLead.set(`${contact.lead_id}|${lower(contact.email)}`, contact);
    if (contact.hubspot_contact_id) contactsByHubspotId.set(contact.hubspot_contact_id, contact);
  }

  return {
    byHubspotCompanyId,
    byCompanyCity,
    byLeadEmail,
    contactsByEmailLead,
    contactsByHubspotId,
  };
}

function cloneContactMaps(maps) {
  return {
    contactsByEmailLead: new Map(maps.contactsByEmailLead),
    contactsByHubspotId: new Map(maps.contactsByHubspotId),
  };
}

function approvalLeadKey(plan) {
  if (plan.existingLead?.id) return plan.existingLead.id;
  return [
    "new",
    plan.lead.hubspot_company_id || "",
    lower(plan.lead.company_name),
    lower(plan.lead.city),
    lower(plan.lead.email),
  ].join("|");
}

function publicContactReference(contact) {
  if (!contact) return null;
  return {
    id: contact.id || null,
    lead_id: contact.lead_id || null,
    email: contact.email || null,
    hubspot_contact_id: contact.hubspot_contact_id || null,
  };
}

function resolveContactOperation(contact, leadId, maps) {
  const emailKey = contact.email ? `${leadId}|${lower(contact.email)}` : "";
  if (contact.hubspot_contact_id && maps.contactsByHubspotId.has(contact.hubspot_contact_id)) {
    return {
      action: "skip_existing_hubspot_contact",
      targetContact: publicContactReference(maps.contactsByHubspotId.get(contact.hubspot_contact_id)),
      incomingHubspotContactId: contact.hubspot_contact_id,
      incomingEmail: contact.email || null,
    };
  }
  if (emailKey && maps.contactsByEmailLead.has(emailKey)) {
    const existingContact = maps.contactsByEmailLead.get(emailKey);
    return {
      action: contact.hubspot_contact_id && !existingContact.hubspot_contact_id
        ? "update_existing_email_contact_metadata"
        : "skip_existing_email_contact",
      targetContact: publicContactReference(existingContact),
      incomingHubspotContactId: contact.hubspot_contact_id || null,
      incomingEmail: contact.email || null,
    };
  }
  return {
    action: "insert_contact",
    targetContact: null,
    incomingHubspotContactId: contact.hubspot_contact_id || null,
    incomingEmail: contact.email || null,
    resetsPrimaryContact: Boolean(contact.is_primary),
  };
}

function applyResolvedContactOperation(operation, contact, leadId, maps, options = {}) {
  if (operation.action === "update_existing_email_contact_metadata" && contact.hubspot_contact_id) {
    const updatedContact = {
      ...operation.targetContact,
      hubspot_contact_id: contact.hubspot_contact_id,
    };
    if (contact.email) maps.contactsByEmailLead.set(`${leadId}|${lower(contact.email)}`, updatedContact);
    maps.contactsByHubspotId.set(contact.hubspot_contact_id, updatedContact);
  }
  if (operation.action === "insert_contact") {
    const insertedContact = {
      id: options.insertedContactId || `virtual:${leadId}:${lower(contact.email || contact.name || contact.hubspot_contact_id)}`,
      lead_id: leadId,
      email: contact.email,
      hubspot_contact_id: contact.hubspot_contact_id,
    };
    if (contact.email) maps.contactsByEmailLead.set(`${leadId}|${lower(contact.email)}`, insertedContact);
    if (contact.hubspot_contact_id) maps.contactsByHubspotId.set(contact.hubspot_contact_id, insertedContact);
  }
}

async function commitPlan(supabase, plan, maps) {
  let leadId = plan.existingLead?.id;
  if (plan.action === "insert_lead") {
    const { data, error } = await supabase.from("leads").insert(plan.lead).select("id").single();
    if (error) throw new Error(`${plan.lead.company_name}: ${error.message}`);
    leadId = data.id;
  } else {
    const { error } = await supabase
      .from("leads")
      .update(plan.lead)
      .eq("id", leadId)
      .eq("tenant", TENANT);
    if (error) throw new Error(`${plan.existingLead.company_name}: ${error.message}`);
  }

  const createdContacts = [];
  for (const contact of plan.contacts) {
    const operation = resolveContactOperation(contact, leadId, maps);
    if (operation.action === "skip_existing_hubspot_contact" || operation.action === "skip_existing_email_contact") {
      continue;
    }
    if (operation.action === "update_existing_email_contact_metadata") {
      const { data, error } = await supabase
        .from("contacts")
        .update({
          hubspot_contact_id: contact.hubspot_contact_id,
          hubspot_imported_at: contact.hubspot_imported_at,
        })
        .eq("id", operation.targetContact.id)
        .eq("tenant", TENANT)
        .select("id, lead_id, email, hubspot_contact_id")
        .single();
      if (error) throw new Error(`Contact ${contact.name} metadata bijwerken: ${error.message}`);
      applyResolvedContactOperation(operation, contact, leadId, maps, { insertedContactId: data.id });
      continue;
    }
    if (contact.is_primary) {
      const { error } = await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("lead_id", leadId)
        .eq("tenant", TENANT);
      if (error) throw new Error(`Primair contact herstellen voor ${contact.name}: ${error.message}`);
    }

    const { data, error } = await supabase
      .from("contacts")
      .insert({ ...contact, lead_id: leadId })
      .select("id")
      .single();
    if (error) throw new Error(`Contact ${contact.name}: ${error.message}`);
    createdContacts.push(data.id);
    applyResolvedContactOperation(operation, contact, leadId, maps, { insertedContactId: data.id });
  }

  const { data: existingNotes, error: existingNotesError } = await supabase
    .from("notes")
    .select("content")
    .eq("lead_id", leadId)
    .eq("tenant", TENANT)
    .ilike("content", `%${HUBSPOT_IMPORT_MARKER}%`);
  if (existingNotesError) {
    throw new Error(`Kon bestaande HubSpot-notities niet controleren: ${existingNotesError.message}`);
  }
  const existingImportKeys = new Set(
    (existingNotes || [])
      .map((note) => String(note.content || "").match(new RegExp(`${HUBSPOT_IMPORT_MARKER}\\s*([^\\n]+)`))?.[1]?.trim())
      .filter(Boolean)
  );

  const summaryKey = plan.lead.hubspot_company_id
    ? `hubspot-summary:${plan.lead.hubspot_company_id}`
    : `hubspot-summary:${leadId}`;
  if (!existingImportKeys.has(summaryKey)) {
    const { error } = await supabase.from("notes").insert({
      lead_id: leadId,
      content: `${HUBSPOT_IMPORT_MARKER} ${summaryKey}\n${plan.noteContent}`,
      note_type: "intern",
      created_by: IMPORT_USER,
      tenant: TENANT,
    });
    if (error) throw new Error(`HubSpot samenvattingsnotitie: ${error.message}`);
    existingImportKeys.add(summaryKey);
  }
  let createdAssociatedNotes = 0;
  let skippedAssociatedNotes = 0;
  for (const note of plan.associatedNotes) {
    if (note.importKey && existingImportKeys.has(note.importKey)) {
      skippedAssociatedNotes++;
      continue;
    }
    const { error } = await supabase.from("notes").insert({
      lead_id: leadId,
      content: note.content,
      note_type: "intern",
      created_by: IMPORT_USER,
      tenant: TENANT,
    });
    if (error) throw new Error(`HubSpot ${note.type}-notitie: ${error.message}`);
    createdAssociatedNotes++;
    if (note.importKey) existingImportKeys.add(note.importKey);
  }
  const { error: activityError } = await supabase.from("activities").insert({
    lead_id: leadId,
    activity_type: "hubspot_import",
    description: "HubSpot gegevens geïmporteerd",
    created_by: IMPORT_USER,
    tenant: TENANT,
    metadata: {
      action: plan.action,
      created_contact_ids: createdContacts,
      associated_notes: plan.associatedNotes.length,
      created_associated_notes: createdAssociatedNotes,
      skipped_associated_notes: skippedAssociatedNotes,
      source: SOURCE,
      raw: plan.raw,
    },
  });
  if (activityError) throw new Error(`HubSpot importactiviteit: ${activityError.message}`);

  return { leadId, createdContacts: createdContacts.length, createdAssociatedNotes, skippedAssociatedNotes };
}

async function main() {
  console.log(`\nHipHot HubSpot import - ${AUDIT ? "EXPORT AUDIT" : DRY ? "DRY RUN" : "LIVE COMMIT"}`);
  console.log(`Tenant: ${TENANT}`);
  console.log(`Bedrijvenbestand: ${companiesPath || "(niet opgegeven)"}`);
  console.log(`Contactbestand: ${contactsPath || "(niet opgegeven)"}`);
  console.log(`Dealsbestand: ${dealsPath || "(niet opgegeven)"}`);
  console.log(`Notitiebestand: ${notesPath || "(niet opgegeven)"}`);
  console.log(`Lijstmap: ${listsPath || "(niet opgegeven)"}`);
  if (listArgs.length) console.log(`Losse lijstbestanden: ${listArgs.length}`);
  console.log(`Rapport: ${reportPath}\n`);
  if (markdownReportPath) console.log(`Leesbaar rapport: ${markdownReportPath}`);
  if (approvedReportPath) console.log(`Goedgekeurde dry-run: ${approvedReportPath}`);

  if (!contactsPath && !companiesPath && !dealsPath && !notesPath && !listsPath && listArgs.length === 0) {
    throw new Error("Geef minimaal --contacts=..., --companies=..., --deals=..., --notes=..., --lists=... of --list=... mee.");
  }

  const companyRows = readRows(companiesPath);
  const contactRows = readRows(contactsPath);
  const dealRows = readRows(dealsPath);
  const noteRows = readRows(notesPath);
  const listExports = readListExports();

  if (AUDIT) {
    const report = buildAuditReport({ companyRows, contactRows, dealRows, noteRows, listExports });
    writeReports(report);
    console.log(`Bedrijfskolommen: ${report.companies.columns.length}`);
    console.log(`Contactkolommen: ${report.contacts.columns.length}`);
    console.log(`Dealkolommen: ${report.deals.columns.length}`);
    console.log(`Notitiekolommen: ${report.notes.columns.length}`);
    console.log(`Marketingkolommen gevonden: ${report.contacts.marketing.marketingColumns.length}`);
    console.log(`Lijstexports gevonden: ${report.lists.length}`);
    console.log(`Herkende segmenthits: ${report.contacts.marketing.recognizedSegments.length}`);
    console.log(`Lijstexports zonder segmentmapping: ${report.lists.filter((item) => item.needsManualMapping).length}`);
    console.log(`Mogelijk onbekende segmentwaarden: ${report.contacts.marketing.possibleUnmappedSegmentValues.length}`);
    console.log("Geen CRM-vergelijking gedaan en geen wijzigingen geschreven.");
    return;
  }

  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials ontbreken. Check .env.local.");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const companies = companyRows.map(parseCompany);
  const deals = dealRows.map(parseDeal).filter((deal) => deal.content);
  const hubspotNotes = noteRows.map(parseHubSpotNote).filter((note) => note.content);
  const listContacts = listExports
    .filter((listExport) => listExport.segmentId)
    .flatMap((listExport) => listExport.rows.map((row) => parseListMember(listExport, row)))
    .filter((contact) => contact.email || contact.hubspotContactId || contact.fullName || contact.companyName);
  const contacts = mergeContactRecords([
    ...contactRows.map(parseContact),
    ...listContacts,
  ]).filter((contact) => contact.email || contact.fullName || contact.companyName);
  const groups = groupRecords(companies, contacts);
  const unmatchedAssociatedRecords = attachAssociatedRecords(groups, [...deals, ...hubspotNotes]);
  const unmatchedDeals = unmatchedAssociatedRecords.filter((record) => record.type === "deal");
  const unmatchedNotes = unmatchedAssociatedRecords.filter((record) => record.type === "note");
  const existing = await fetchExisting(supabase);
  const maps = buildMaps(existing);

  const plans = groups.map((group) => buildPlan(group, findExistingLead(group, maps)));
  const approvalPlan = importApprovalPlan(plans, maps);
  const report = {
    mode: DRY ? "dry-run" : "commit",
    tenant: TENANT,
    options: {
      overwrite: OVERWRITE,
      limit,
    },
    input: {
      companiesPath,
      contactsPath,
      dealsPath,
      notesPath,
      listsPath,
      listArgs,
      companyRows: companyRows.length,
      contactRows: contactRows.length,
      dealRows: dealRows.length,
      noteRows: noteRows.length,
      listFiles: listExports.length,
      listRows: listExports.reduce((sum, listExport) => sum + listExport.rows.length, 0),
    },
    existing: {
      leads: existing.leads.length,
      contacts: existing.contacts.length,
    },
    planned: {
      groups: groups.length,
      insertLeads: plans.filter((plan) => plan.action === "insert_lead").length,
      updateLeads: plans.filter((plan) => plan.action === "update_lead").length,
      contactsSeen: contacts.length,
      contactsPlanned: plans.reduce((sum, plan) => sum + plan.contacts.length, 0),
      dealsSeen: deals.length,
      notesSeen: hubspotNotes.length,
      associatedNotesPlanned: plans.reduce((sum, plan) => sum + plan.associatedNotes.length, 0),
      marketingAllowedCompanies: plans.filter((plan) => plan.lead.marketing_consent).length,
      algemeneNieuwsbriefCompanies: plans.filter((plan) => plan.lead.marketing_segments?.includes("algemene_nieuwsbrief")).length,
      factor30Companies: plans.filter((plan) => plan.lead.marketing_segments?.includes("factor_30")).length,
      factor50Companies: plans.filter((plan) => plan.lead.marketing_segments?.includes("factor_50")).length,
      listContactsSeen: listContacts.length,
    },
    samples: plans.slice(0, 5).map((plan) => ({
      action: plan.action,
      existingLeadId: plan.existingLead?.id || null,
      company: plan.existingLead?.company_name || plan.lead.company_name,
      marketingConsent: plan.lead.marketing_consent,
      marketingSegments: plan.lead.marketing_segments,
      contacts: plan.contacts.map((contact) => ({
        name: contact.name,
        email: contact.email,
        hubspotContactId: contact.hubspot_contact_id,
      })),
      dealCount: plan.associatedNotes.filter((note) => note.type === "deal").length,
      noteCount: plan.associatedNotes.filter((note) => note.type === "note").length,
    })),
    warnings: {
      noCompanyName: groups.filter((group) => !group.company.companyName).length,
      unknownMarketingStatusContacts: contacts.filter((contact) => contact.marketing.status === "unknown").length,
      noRecognizedSegmentContacts: contacts.filter((contact) => contact.marketing.segments.length === 0).length,
      unmatchedDeals: unmatchedDeals.length,
      unmatchedNotes: unmatchedNotes.length,
      listFilesWithoutSegmentMapping: listExports.filter((listExport) => !listExport.segmentId).map((listExport) => listExport.fileName),
    },
    approval: {
      overwrite: OVERWRITE,
      limit,
      mutationFingerprint: fingerprint(approvalPlan),
    },
    approvalPlan,
  };

  if (!DRY) {
    assertApprovedDryRun(report);
    let committed = 0;
    let failed = 0;
    let createdAssociatedNotes = 0;
    let skippedAssociatedNotes = 0;
    for (const plan of plans) {
      try {
        const result = await commitPlan(supabase, plan, maps);
        createdAssociatedNotes += result.createdAssociatedNotes;
        skippedAssociatedNotes += result.skippedAssociatedNotes;
        committed++;
      } catch (error) {
        failed++;
        console.error(`Mislukt: ${error.message}`);
      }
    }
    report.commit = { committed, failed, createdAssociatedNotes, skippedAssociatedNotes };
  }

  writeReports(report);

  console.log(`Bedrijven/groepen: ${report.planned.groups}`);
  console.log(`Nieuwe leads: ${report.planned.insertLeads}`);
  console.log(`Bij te werken leads: ${report.planned.updateLeads}`);
  console.log(`Contactpersonen gevonden: ${report.planned.contactsSeen}`);
  console.log(`Contactpersonen uit losse lijsten: ${report.planned.listContactsSeen}`);
  console.log(`HubSpot deals als notitie: ${report.planned.dealsSeen}`);
  console.log(`HubSpot notities als notitie: ${report.planned.notesSeen}`);
  console.log(`Marketing toegestaan: ${report.planned.marketingAllowedCompanies}`);
  console.log(`Algemene nieuwsbrief: ${report.planned.algemeneNieuwsbriefCompanies}`);
  console.log(`Factor 30: ${report.planned.factor30Companies}`);
  console.log(`Factor 50: ${report.planned.factor50Companies}`);
  if (report.commit) {
    console.log(`Commit: ${report.commit.committed} gelukt, ${report.commit.failed} mislukt`);
    console.log(`HubSpot notities toegevoegd: ${report.commit.createdAssociatedNotes}`);
    console.log(`HubSpot notities overgeslagen als duplicaat: ${report.commit.skippedAssociatedNotes}`);
  } else {
    console.log("Geen wijzigingen gedaan. Gebruik --commit na controle van het rapport.");
  }
  if (markdownReportPath) console.log(`Leesbaar rapport geschreven: ${markdownReportPath}`);
}

main().catch((error) => {
  console.error(`Fout: ${error.message}`);
  process.exit(1);
});

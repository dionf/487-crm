#!/usr/bin/env node
/**
 * HubSpot -> HipHot CRM import.
 *
 * Default is a dry-run. Use --commit only after reviewing the report.
 *
 * Examples:
 *   node scripts/import-hubspot-hiphot.mjs \
 *     --companies=/path/hubspot-companies.xlsx \
 *     --contacts=/path/hubspot-contacts.xlsx \
 *     --report=/tmp/hiphot-hubspot-import-report.json
 *
 *   node scripts/import-hubspot-hiphot.mjs --contacts=/path/contacts.csv --commit
 */

import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

const TENANT = "hiphot";
const SOURCE = "hubspot";
const IMPORT_USER = "HubSpot import";
const DEFAULT_REPORT = "/tmp/hiphot-hubspot-import-report.json";
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
const DRY = args.includes("--dry-run") || !args.includes("--commit");
const OVERWRITE = args.includes("--overwrite");
const companiesPath = argValue("--companies");
const contactsPath = argValue("--contacts");
const reportPath = argValue("--report") || DEFAULT_REPORT;
const limit = Number(argValue("--limit") || 0);

const MARKETING_SEGMENT_IDS = new Set(HIPHOT_MARKETING_SEGMENTS.map((s) => s.id));
const MARKETING_STATUS_IDS = new Set(HIPHOT_MARKETING_STATUSES.map((s) => s.id));
const SEGMENT_PATTERNS = [
  { id: "factor_30", patterns: [/factor\s*30/i, /spf\s*30/i] },
  { id: "factor_50", patterns: [/factor\s*50/i, /spf\s*50/i] },
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

function firstNonEmpty(...values) {
  return values.find((value) => text(value)) || "";
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
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

function parseMarketing(row) {
  const haystackValues = [
    get(row, ["Marketing contact status", "Marketing status", "Marketing Contact"]),
    get(row, ["Email subscription status", "Subscription status", "Nieuwsbrief status"]),
    get(row, ["Opted out of email", "Unsubscribed from all email", "Uitgeschreven"]),
    get(row, ["Email hard bounce reason", "Hard bounce reason", "Hard bounce"]),
    get(row, ["List memberships", "Lists", "Tags", "Segmenten", "Tags/segmenten"]),
  ];
  const haystack = haystackValues.map(text).join(" | ");
  const lowerHaystack = haystack.toLowerCase();
  const hardBounce = /hard bounce|bounced|bounce/i.test(haystack);
  const unsubscribed = /unsubscribed|opted out|uitgeschreven|afgemeld/i.test(haystack);
  const subscribed = /subscribed|marketing contact|ingeschreven|nieuwsbrief/i.test(haystack) && !unsubscribed && !hardBounce;
  const nonMarketing = /non.?marketing|geen marketing|not a marketing contact/i.test(haystack);

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
        : subscribed
          ? "subscribed"
          : nonMarketing
            ? "non_marketing"
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

  function keyFor({ hubspotCompanyId, companyName, domain, email }) {
    if (hubspotCompanyId) return `company:${hubspotCompanyId}`;
    if (domain) return `domain:${domain}`;
    if (companyName) return `name:${lower(companyName)}`;
    if (email) return `email:${email}`;
    return "";
  }

  for (const company of companies) {
    const key = keyFor(company);
    if (!key || !company.companyName) continue;
    groups.set(key, { company, contacts: [] });
  }

  for (const contact of contacts) {
    const key = keyFor({
      hubspotCompanyId: contact.associatedCompanyId,
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
      groups.set(key, { company: fallbackCompany, contacts: [] });
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
  const segmentLabels = group.contacts.flatMap((contact) => contact.marketing.segments);
  if (segmentLabels.length) lines.push(`Marketingsegmenten: ${[...new Set(segmentLabels)].join(", ")}`);
  return lines.join("\n");
}

async function fetchExisting(supabase) {
  const [{ data: leads, error: leadError }, { data: contacts, error: contactError }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, company_name, city, email, hubspot_company_id, marketing_segments, marketing_consent, contact_person, contact_first_name, contact_last_name, contact_function, phone, website_url, address, billing_street, billing_postal_code, billing_city, billing_country, delivery_same_as_billing, delivery_street, delivery_postal_code, delivery_city, delivery_country, industry, language")
      .eq("tenant", TENANT),
    supabase
      .from("contacts")
      .select("id, lead_id, email, hubspot_contact_id")
      .eq("tenant", TENANT),
  ]);
  if (leadError) throw new Error(`Kon bestaande HipHot leads niet ophalen: ${leadError.message}`);
  if (contactError) throw new Error(`Kon bestaande HipHot contacten niet ophalen: ${contactError.message}`);
  return { leads: leads || [], contacts: contacts || [] };
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
  const contactsByEmailLead = new Set();
  const contactsByHubspotId = new Set();

  for (const lead of existing.leads) {
    if (lead.hubspot_company_id) byHubspotCompanyId.set(lead.hubspot_company_id, lead);
    byCompanyCity.set(`${lower(lead.company_name)}|${lower(lead.city)}`, lead);
    if (lead.email) byLeadEmail.set(lower(lead.email), lead);
  }
  for (const contact of existing.contacts) {
    if (contact.email) contactsByEmailLead.add(`${contact.lead_id}|${lower(contact.email)}`);
    if (contact.hubspot_contact_id) contactsByHubspotId.add(contact.hubspot_contact_id);
  }

  return {
    byHubspotCompanyId,
    byCompanyCity,
    byLeadEmail,
    contactsByEmailLead,
    contactsByHubspotId,
  };
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
    const emailKey = contact.email ? `${leadId}|${lower(contact.email)}` : "";
    if (contact.hubspot_contact_id && maps.contactsByHubspotId.has(contact.hubspot_contact_id)) continue;
    if (emailKey && maps.contactsByEmailLead.has(emailKey)) continue;
    if (contact.is_primary) {
      await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("lead_id", leadId)
        .eq("tenant", TENANT);
    }

    const { data, error } = await supabase
      .from("contacts")
      .insert({ ...contact, lead_id: leadId })
      .select("id")
      .single();
    if (error) throw new Error(`Contact ${contact.name}: ${error.message}`);
    createdContacts.push(data.id);
    if (emailKey) maps.contactsByEmailLead.add(emailKey);
    if (contact.hubspot_contact_id) maps.contactsByHubspotId.add(contact.hubspot_contact_id);
  }

  await supabase.from("notes").insert({
    lead_id: leadId,
    content: plan.noteContent,
    note_type: "intern",
    created_by: IMPORT_USER,
    tenant: TENANT,
  });
  await supabase.from("activities").insert({
    lead_id: leadId,
    activity_type: "hubspot_import",
    description: "HubSpot gegevens geïmporteerd",
    created_by: IMPORT_USER,
    tenant: TENANT,
    metadata: {
      action: plan.action,
      created_contact_ids: createdContacts,
      source: SOURCE,
      raw: plan.raw,
    },
  });

  return { leadId, createdContacts: createdContacts.length };
}

async function main() {
  console.log(`\nHipHot HubSpot import - ${DRY ? "DRY RUN" : "LIVE COMMIT"}`);
  console.log(`Tenant: ${TENANT}`);
  console.log(`Bedrijvenbestand: ${companiesPath || "(niet opgegeven)"}`);
  console.log(`Contactbestand: ${contactsPath || "(niet opgegeven)"}`);
  console.log(`Rapport: ${reportPath}\n`);

  if (!contactsPath && !companiesPath) {
    throw new Error("Geef minimaal --contacts=... of --companies=... mee.");
  }

  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials ontbreken. Check .env.local.");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const companyRows = readRows(companiesPath);
  const contactRows = readRows(contactsPath);
  const companies = companyRows.map(parseCompany);
  const contacts = contactRows.map(parseContact).filter((contact) => contact.email || contact.fullName || contact.companyName);
  const groups = groupRecords(companies, contacts);
  const existing = await fetchExisting(supabase);
  const maps = buildMaps(existing);

  const plans = groups.map((group) => buildPlan(group, findExistingLead(group, maps)));
  const report = {
    mode: DRY ? "dry-run" : "commit",
    tenant: TENANT,
    input: {
      companiesPath,
      contactsPath,
      companyRows: companyRows.length,
      contactRows: contactRows.length,
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
      marketingAllowedCompanies: plans.filter((plan) => plan.lead.marketing_consent).length,
      factor30Companies: plans.filter((plan) => plan.lead.marketing_segments?.includes("factor_30")).length,
      factor50Companies: plans.filter((plan) => plan.lead.marketing_segments?.includes("factor_50")).length,
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
    })),
    warnings: {
      noCompanyName: groups.filter((group) => !group.company.companyName).length,
      unknownMarketingStatusContacts: contacts.filter((contact) => contact.marketing.status === "unknown").length,
      noRecognizedSegmentContacts: contacts.filter((contact) => contact.marketing.segments.length === 0).length,
    },
  };

  if (!DRY) {
    let committed = 0;
    let failed = 0;
    for (const plan of plans) {
      try {
        await commitPlan(supabase, plan, maps);
        committed++;
      } catch (error) {
        failed++;
        console.error(`Mislukt: ${error.message}`);
      }
    }
    report.commit = { committed, failed };
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Bedrijven/groepen: ${report.planned.groups}`);
  console.log(`Nieuwe leads: ${report.planned.insertLeads}`);
  console.log(`Bij te werken leads: ${report.planned.updateLeads}`);
  console.log(`Contactpersonen gevonden: ${report.planned.contactsSeen}`);
  console.log(`Marketing toegestaan: ${report.planned.marketingAllowedCompanies}`);
  console.log(`Factor 30: ${report.planned.factor30Companies}`);
  console.log(`Factor 50: ${report.planned.factor50Companies}`);
  if (report.commit) {
    console.log(`Commit: ${report.commit.committed} gelukt, ${report.commit.failed} mislukt`);
  } else {
    console.log("Geen wijzigingen gedaan. Gebruik --commit na controle van het rapport.");
  }
}

main().catch((error) => {
  console.error(`Fout: ${error.message}`);
  process.exit(1);
});

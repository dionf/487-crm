#!/usr/bin/env node
/**
 * Read-only HubSpot API snapshot for the HipHot migration.
 *
 * Writes xlsx files that can be fed into scripts/import-hubspot-hiphot.mjs.
 * Keep HUBSPOT_ACCESS_TOKEN out of git and pass it through the environment.
 */

import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const args = process.argv.slice(2);
const tokenEnv = argValue("--token-env") || "HUBSPOT_ACCESS_TOKEN";
const accessToken = process.env[tokenEnv];
const outDir = path.resolve(argValue("--out") || "/tmp/hiphot-hubspot-api-export");
const limit = Number(argValue("--limit") || 0);
const strictMarketing = args.includes("--strict-marketing");
const skipDeals = args.includes("--skip-deals");
const skipNotes = args.includes("--skip-notes");
const contactObjectTypeId = "0-1";
const listMappings = [
  { segmentId: "factor_30", fileName: "hubspot-list-factor-30.xlsx", names: ["Factor 30", "Factor30", "SPF 30", "SPF30 kopers NL"] },
  { segmentId: "factor_50", fileName: "hubspot-list-factor-50.xlsx", names: ["Factor 50", "Factor50", "SPF 50", "SPF50 kopers NL"] },
];

if (!accessToken) {
  throw new Error(`HubSpot token ontbreekt. Zet ${tokenEnv}=... en draai opnieuw.`);
}

function argValue(name) {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function repeatArgs(name) {
  return args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));
}

function text(value) {
  return String(value ?? "").trim();
}

function boolText(value) {
  if (value === true || value === "true") return "true";
  if (value === false || value === "false") return "false";
  return text(value);
}

function idFromAssociation(record, associationName) {
  return record.associations?.[associationName]?.results?.[0]?.id || "";
}

function cleanHtml(value) {
  return text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function hubspot(pathname, options = {}) {
  const url = new URL(pathname, "https://api.hubapi.com");
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status !== 429) break;
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(retryAfter ? retryAfter * 1000 : 1000 * (attempt + 1));
  }
  const body = await response.text();
  let payload = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    payload = { raw: body };
  }
  if (!response.ok) {
    const missingScopes = payload.errors?.flatMap((error) => error.context?.requiredGranularScopes || error.context?.missingScopes || []) || [];
    const error = new Error(payload.message || `HubSpot API fout ${response.status}`);
    error.status = response.status;
    error.category = payload.category;
    error.missingScopes = missingScopes;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fetchAllObjects(objectName, properties, associations = []) {
  const results = [];
  let after = "";
  do {
    const page = await hubspot(`/crm/v3/objects/${objectName}`, {
      query: {
        limit: 100,
        after,
        archived: false,
        properties: properties.join(","),
        associations: associations.join(","),
      },
    });
    results.push(...(page.results || []));
    after = page.paging?.next?.after || "";
  } while (after && (!limit || results.length < limit));
  return limit ? results.slice(0, limit) : results;
}

async function batchReadObjects(objectName, ids, properties) {
  const byId = new Map();
  for (const idsChunk of chunk([...new Set(ids.filter(Boolean))], 100)) {
    const page = await hubspot(`/crm/v3/objects/${objectName}/batch/read`, {
      method: "POST",
      body: {
        properties,
        inputs: idsChunk.map((id) => ({ id })),
      },
    });
    for (const record of page.results || []) byId.set(record.id, record);
  }
  return byId;
}

async function searchLists() {
  const lists = [];
  let offset = 0;
  do {
    const previousOffset = offset;
    const page = await hubspot("/crm/lists/2026-03/search", {
      method: "POST",
      body: {
        query: "",
        count: 100,
        offset,
        objectTypeId: contactObjectTypeId,
      },
    });
    const pageLists = page.lists || page.results || [];
    lists.push(...pageLists);
    offset = Number(page.offset || 0);
    if (pageLists.length < 100) offset = 0;
    else if (!Number.isFinite(offset) || offset <= previousOffset) offset = previousOffset + 100;
  } while (offset && (!limit || lists.length < limit));
  return lists;
}

async function fetchListMembershipIds(listId) {
  const recordIds = [];
  let after = "";
  do {
    const page = await hubspot(`/crm/lists/2026-03/${listId}/memberships`, {
      query: { limit: 250, after },
    });
    recordIds.push(...(page.results || []).map((item) => item.recordId || item.record?.id).filter(Boolean));
    after = page.paging?.next?.after || "";
  } while (after);
  return recordIds;
}

async function fetchSubscriptionStatuses(emails) {
  const byEmail = new Map();
  const uniqueEmails = [...new Set(emails.filter(Boolean).map((email) => text(email).toLowerCase()))];
  try {
    for (const emailsChunk of chunk(uniqueEmails, 100)) {
      const page = await hubspot("/communication-preferences/2026-03/statuses/batch/read", {
        method: "POST",
        query: { channel: "EMAIL" },
        body: { inputs: emailsChunk },
      });
      for (const result of page.results || []) {
        const email = text(result.subscriberIdString).toLowerCase();
        byEmail.set(email, result.statuses || []);
      }
    }
    return { byEmail, source: "communication-preferences-2026-03-batch" };
  } catch (error) {
    if (!error.missingScopes?.includes("communication_preferences.statuses.batch.read")) throw error;
  }

  let failed = 0;
  await mapWithConcurrency(uniqueEmails, 8, async (email) => {
    try {
      const page = await hubspot(`/communication-preferences/v3/status/email/${encodeURIComponent(email)}`);
      byEmail.set(email, page.subscriptionStatuses || []);
    } catch (error) {
      if (error.category === "MISSING_SCOPES") throw error;
      if (error.status !== 404) failed++;
      byEmail.set(email, []);
    }
  });
  return { byEmail, source: "communication-preferences-v3-email-status", failed };
}

function formatSubscriptionStatuses(statuses) {
  return (statuses || [])
    .map((status) => {
      const name = status.subscriptionName || status.name || status.subscriptionId || status.id || "";
      const state = status.status || status.subscriptionStatus || "";
      return [name, state].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
}

function truthyMarketingValue(value) {
  return /^(true|yes|ja|1|subscribed|ingeschreven)$/i.test(text(value));
}

function hasMarketingInformationSubscription(statuses) {
  return (statuses || []).some((status) => {
    const name = text(status.subscriptionName || status.name || status.subscriptionId || status.id);
    const state = text(status.status || status.subscriptionStatus);
    return /marketing information|marketing|nieuwsbrief|newsletter/i.test(name) && /^subscribed$/i.test(state);
  });
}

function customListMappings() {
  const custom = repeatArgs("--list-name").map((spec) => {
    const separator = spec.indexOf(":");
    if (separator < 1) throw new Error("Gebruik --list-name=segment_id:Exacte HubSpot lijstnaam.");
    return {
      segmentId: spec.slice(0, separator),
      fileName: `hubspot-list-${spec.slice(0, separator)}.xlsx`,
      names: [spec.slice(separator + 1)],
    };
  });
  return custom.length ? custom : listMappings;
}

function findList(lists, mapping) {
  const wanted = mapping.names.map((name) => text(name).toLowerCase());
  return lists.find((list) => wanted.includes(text(list.name || list.listName).toLowerCase()))
    || lists.find((list) => wanted.some((name) => text(list.name || list.listName).toLowerCase().includes(name)));
}

function writeWorkbook(filePath, rows) {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, "Export");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  xlsx.writeFile(workbook, filePath);
}

function companyRow(record) {
  const p = record.properties || {};
  return {
    "Company ID": record.id,
    "Company name": p.name || "",
    "Company domain name": p.domain || "",
    City: p.city || "",
    Email: p.email || "",
    "Phone number": p.phone || "",
    "Website URL": p.website || p.domain || "",
    "Street address": p.address || "",
    "Postal code": p.zip || "",
    "Country/Region": p.country || "",
    Industry: p.industry || "",
    "Create date": p.createdate || record.createdAt || "",
    "Last modified date": p.hs_lastmodifieddate || record.updatedAt || "",
  };
}

function contactRow(record, companiesById, subscriptionStatuses) {
  const p = record.properties || {};
  const companyId = idFromAssociation(record, "companies");
  const company = companiesById.get(companyId)?.properties || {};
  const email = text(p.email).toLowerCase();
  const statuses = subscriptionStatuses.get(email) || [];
  const listMemberships = [];
  if (
    hasMarketingInformationSubscription(statuses)
    || truthyMarketingValue(p.marketing_newsletter)
    || truthyMarketingValue(p.newsletter_subscription)
  ) {
    listMemberships.push("Algemene nieuwsbrief");
  }
  return {
    "Record ID": record.id,
    "Associated Company ID": companyId,
    "Company name": company.name || "",
    "Company domain name": company.domain || "",
    "First name": p.firstname || "",
    "Last name": p.lastname || "",
    Email: p.email || "",
    "Phone number": p.phone || p.mobilephone || "",
    "Job title": p.jobtitle || "",
    "Marketing contact status": p.hs_marketable_status || "",
    "Email subscription status": formatSubscriptionStatuses(statuses),
    "List memberships": listMemberships.join("; "),
    "Opted out of email": boolText(p.hs_email_optout),
    "Email hard bounce reason": p.hs_email_hard_bounce_reason || p.hs_email_hard_bounce_reason_enum || "",
    "Subscribed to email subscription types": p.hs_email_communication_subscriptions_opted_in || "",
    "Unsubscribed from email subscription types": p.hs_email_communication_subscriptions_opted_out || "",
    "Marketing nieuwsbrief": p.marketing_newsletter || "",
    "Accepteert marketing": p.newsletter_subscription || "",
    "Has active subscription": boolText(p.hs_has_active_subscription),
    "Create date": p.createdate || record.createdAt || "",
    "Last modified date": p.lastmodifieddate || p.hs_lastmodifieddate || record.updatedAt || "",
  };
}

function dealRow(record, companiesById) {
  const p = record.properties || {};
  const companyId = idFromAssociation(record, "companies");
  const company = companiesById.get(companyId)?.properties || {};
  return {
    "Record ID": record.id,
    "Associated Company ID": companyId,
    "Company name": company.name || "",
    "Company domain name": company.domain || "",
    "Deal name": p.dealname || "",
    Amount: p.amount || "",
    "Deal stage": p.dealstage || "",
    Pipeline: p.pipeline || "",
    "Close date": p.closedate || "",
    "Create date": p.createdate || record.createdAt || "",
    "Deal owner": p.hubspot_owner_id || "",
  };
}

function noteRow(record, companiesById) {
  const p = record.properties || {};
  const companyId = idFromAssociation(record, "companies");
  const company = companiesById.get(companyId)?.properties || {};
  return {
    "Record ID": record.id,
    "Associated Company ID": companyId,
    "Company name": company.name || "",
    "Company domain name": company.domain || "",
    "Note body": cleanHtml(p.hs_note_body),
    "Create date": p.hs_timestamp || p.createdate || record.createdAt || "",
    "Note owner": p.hubspot_owner_id || "",
  };
}

function listMemberRow(contact, segmentLabel, companiesById) {
  const p = contact.properties || {};
  const companyId = idFromAssociation(contact, "companies");
  const company = companiesById.get(companyId)?.properties || {};
  return {
    "Record ID": contact.id,
    "Associated Company ID": companyId,
    "Company ID": companyId,
    "Company name": company.name || "",
    "Company domain name": company.domain || "",
    "First name": p.firstname || "",
    "Last name": p.lastname || "",
    Email: p.email || "",
    "Marketing contact status": "Marketing contact",
    "List memberships": segmentLabel,
  };
}

function writeManifest(manifest) {
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

async function main() {
  const warnings = [];
  const files = {};
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "lists"), { recursive: true });

  console.log("HubSpot API export voor HipHot CRM");
  console.log(`Outputmap: ${outDir}`);

  const companyProperties = ["name", "domain", "city", "email", "phone", "website", "address", "zip", "country", "industry", "createdate", "hs_lastmodifieddate"];
  const contactProperties = [
    "email",
    "firstname",
    "lastname",
    "phone",
    "mobilephone",
    "jobtitle",
    "hs_marketable_status",
    "hs_email_optout",
    "hs_email_hard_bounce_reason",
    "hs_email_hard_bounce_reason_enum",
    "hs_email_communication_subscriptions_opted_in",
    "hs_email_communication_subscriptions_opted_out",
    "hs_has_active_subscription",
    "marketing_newsletter",
    "newsletter_subscription",
    "createdate",
    "lastmodifieddate",
    "hs_lastmodifieddate",
  ];

  const companies = await fetchAllObjects("companies", companyProperties);
  const contacts = await fetchAllObjects("contacts", contactProperties, ["companies"]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const associatedCompanyIds = contacts.map((contact) => idFromAssociation(contact, "companies")).filter(Boolean);
  let companiesById = new Map(companies.map((company) => [company.id, company]));
  const missingAssociatedCompanies = associatedCompanyIds.filter((id) => !companiesById.has(id));
  if (missingAssociatedCompanies.length) {
    const extraCompanies = await batchReadObjects("companies", missingAssociatedCompanies, companyProperties);
    companiesById = new Map([...companiesById, ...extraCompanies]);
  }

  let subscriptionStatuses = new Map();
  let subscriptionStatusSource = "";
  try {
    const statusResult = await fetchSubscriptionStatuses(contacts.map((contact) => contact.properties?.email));
    subscriptionStatuses = statusResult.byEmail;
    subscriptionStatusSource = statusResult.source;
    if (statusResult.failed) {
      warnings.push(`Nieuwsbriefstatussen: ${statusResult.failed} e-mailadressen konden niet via HubSpot v3 worden gecontroleerd.`);
    }
  } catch (error) {
    const scopeText = error.missingScopes?.join(", ") || "communication_preferences.read";
    warnings.push(`Nieuwsbriefstatussen niet volledig opgehaald: HubSpot mist scope ${scopeText}.`);
    if (strictMarketing) throw error;
  }

  const companiesPath = path.join(outDir, "hubspot-companies.xlsx");
  const contactsPath = path.join(outDir, "hubspot-contacts.xlsx");
  writeWorkbook(companiesPath, companies.map(companyRow));
  writeWorkbook(contactsPath, contacts.map((contact) => contactRow(contact, companiesById, subscriptionStatuses)));
  files.companies = companiesPath;
  files.contacts = contactsPath;

  if (!skipDeals) {
    const deals = await fetchAllObjects("deals", ["dealname", "amount", "dealstage", "pipeline", "closedate", "createdate", "hubspot_owner_id"], ["companies", "contacts"]);
    const dealCompanyIds = deals.map((deal) => idFromAssociation(deal, "companies")).filter((id) => !companiesById.has(id));
    if (dealCompanyIds.length) {
      const extraCompanies = await batchReadObjects("companies", dealCompanyIds, companyProperties);
      companiesById = new Map([...companiesById, ...extraCompanies]);
    }
    const dealsPath = path.join(outDir, "hubspot-deals.xlsx");
    writeWorkbook(dealsPath, deals.map((deal) => dealRow(deal, companiesById)));
    files.deals = dealsPath;
  }

  if (!skipNotes) {
    const notes = await fetchAllObjects("notes", ["hs_note_body", "hs_timestamp", "createdate", "hubspot_owner_id"], ["companies", "contacts", "deals"]);
    const noteCompanyIds = notes.map((note) => idFromAssociation(note, "companies")).filter((id) => !companiesById.has(id));
    if (noteCompanyIds.length) {
      const extraCompanies = await batchReadObjects("companies", noteCompanyIds, companyProperties);
      companiesById = new Map([...companiesById, ...extraCompanies]);
    }
    const notesPath = path.join(outDir, "hubspot-notes.xlsx");
    writeWorkbook(notesPath, notes.map((note) => noteRow(note, companiesById)));
    files.notes = notesPath;
  }

  try {
    const lists = await searchLists();
    files.lists = {};
    for (const mapping of customListMappings()) {
      const list = findList(lists, mapping);
      if (!list) {
        warnings.push(`HubSpot lijst niet gevonden voor segment ${mapping.segmentId}: ${mapping.names.join(" / ")}.`);
        continue;
      }
      const listId = list.listId || list.id;
      const memberIds = await fetchListMembershipIds(listId);
      const missingMemberIds = memberIds.filter((id) => !contactsById.has(String(id)));
      const memberContacts = await batchReadObjects("contacts", missingMemberIds, contactProperties);
      for (const [id, contact] of memberContacts) contactsById.set(id, contact);
      const rows = [...memberContacts.values()].map((contact) => listMemberRow(contact, text(list.name || list.listName), companiesById));
      for (const id of memberIds) {
        const contact = contactsById.get(String(id));
        if (contact && !memberContacts.has(String(id))) rows.push(listMemberRow(contact, text(list.name || list.listName), companiesById));
      }
      const listPath = path.join(outDir, "lists", mapping.fileName);
      writeWorkbook(listPath, rows);
      files.lists[mapping.segmentId] = listPath;
    }
  } catch (error) {
    const scopeText = error.missingScopes?.join(", ") || "crm.lists.read";
    warnings.push(`HubSpot lijsten niet opgehaald: HubSpot mist scope ${scopeText}.`);
    if (strictMarketing) throw error;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "hubspot-api",
    outputDirectory: outDir,
    subscriptionStatusSource,
    counts: {
      companies: companies.length,
      contacts: contacts.length,
    },
    files,
    warnings,
    importCommand: [
      "node scripts/import-hubspot-hiphot.mjs",
      `--companies=${files.companies}`,
      `--contacts=${files.contacts}`,
      files.deals ? `--deals=${files.deals}` : null,
      files.notes ? `--notes=${files.notes}` : null,
      files.lists ? `--lists=${path.join(outDir, "lists")}` : null,
      `--report=${path.join(outDir, "dry-run-report.json")}`,
      `--report-md=${path.join(outDir, "dry-run-report.md")}`,
      "--dry-run",
    ].filter(Boolean).join(" \\\n  "),
  };
  if (files.deals) manifest.counts.deals = xlsx.utils.sheet_to_json(xlsx.readFile(files.deals).Sheets.Export).length;
  if (files.notes) manifest.counts.notes = xlsx.utils.sheet_to_json(xlsx.readFile(files.notes).Sheets.Export).length;
  const manifestPath = writeManifest(manifest);

  console.log(`Bedrijven: ${manifest.counts.companies}`);
  console.log(`Contacten: ${manifest.counts.contacts}`);
  if (manifest.counts.deals !== undefined) console.log(`Deals: ${manifest.counts.deals}`);
  if (manifest.counts.notes !== undefined) console.log(`Notities: ${manifest.counts.notes}`);
  if (warnings.length) {
    console.log("Waarschuwingen:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log(`Manifest: ${manifestPath}`);
  console.log("Geen CRM-wijzigingen gedaan.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Fout: ${error.message}`);
    if (error.missingScopes?.length) console.error(`Ontbrekende HubSpot scopes: ${error.missingScopes.join(", ")}`);
    process.exit(1);
  });

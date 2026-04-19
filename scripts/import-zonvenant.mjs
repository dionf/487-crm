#!/usr/bin/env node
/**
 * One-off import van Zonvenant Partners leads naar het HipHot CRM.
 *
 * Gebruik:
 *   cd /Users/dion/Documents/Dev/487crm
 *   node scripts/import-zonvenant.mjs --dry-run     # toont wat er gebeurt zonder te schrijven
 *   node scripts/import-zonvenant.mjs --commit      # voert echt uit
 *
 * Optioneel:
 *   --file=<pad>   Alternatief xlsx bestand (default: zonvenant_partners.xlsx in Documents/HIPHOT/Diversen/Rapporten)
 *
 * Vereist .env.local in de project root met NEXT_PUBLIC_SUPABASE_URL en
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (of SUPABASE_SERVICE_ROLE_KEY).
 */

import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

// ---- CLI args ----
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || !args.includes("--commit");
const fileArg = args.find((a) => a.startsWith("--file="))?.split("=")[1];
const XLSX_PATH =
  fileArg ||
  "/Users/dion/Documents/HIPHOT/Diversen/Rapporten/zonvenant_partners.xlsx";

// ---- Load .env.local ----
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Supabase credentials ontbreken. Check .env.local.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TENANT = "hiphot";
const SOURCE = "zonvenant_partners";

// ---- Branche mapping naar INDUSTRIES dropdown-id's ----
const BRANCHE_TO_INDUSTRY = {
  kinderopvang: "zorg",
  ziekenhuis: "zorg",
  gezondheidszorg: "zorg",
  ggd: "overheid",
  "school/opleiding": "scholen",
  school: "scholen",
  sport: "sport",
  sportbond: "sport",
  zwembad: "sport",
  recreatie: "sport",
  gemeente: "overheid",
  horeca: "horeca",
  "huidverzorging/schoonheid": "dienstverlening",
  bedrijf: "overig",
  "non-profit/stichting": "overig",
  beroepsvereniging: "overig",
  "rotary/rotaract": "overig",
  overig: "overig",
};

function mapBranche(branche) {
  const key = String(branche || "").trim().toLowerCase();
  return BRANCHE_TO_INDUSTRY[key] || null;
}

// ---- Helpers ----
function normalizePhone(raw) {
  if (!raw) return null;
  // Laat + en cijfers intact, strip de rest
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  return cleaned || null;
}

function normalizeEmail(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  return s;
}

/**
 * "Pompmolenlaan 16, 3447 GK Woerden" → { street, postal, city }
 */
function parseAddress(raw) {
  if (!raw) return {};
  const s = String(raw).trim();
  // Eerst probeer volledig match: <street>, <4 cijfers + 2 letters postcode> <plaats>
  const m = s.match(/^(.+?),\s*(\d{4}\s?[A-Z]{2})\s+(.+)$/);
  if (m) {
    return { street: m[1].trim(), postal_code: m[2].replace(/\s+/g, " ").trim(), city: m[3].trim() };
  }
  // Fallback: splits op eerste komma
  const parts = s.split(",").map((x) => x.trim());
  if (parts.length >= 2) {
    return { street: parts[0], city: parts.slice(1).join(", ") };
  }
  return { street: s };
}

function hoofdToNote(hoofdcategorie, branche, opmerkingen, rawBranche) {
  const lines = [
    `Geïmporteerd uit Zonvenant Partners lijst op ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (hoofdcategorie) lines.push(`Hoofdcategorie: ${hoofdcategorie}`);
  if (rawBranche && !mapBranche(rawBranche)) {
    lines.push(`⚠️ Ruwe Branche "${rawBranche}" kon niet naar een dropdown-waarde gemapt worden — industry leeg gelaten.`);
  } else if (rawBranche) {
    lines.push(`Branche (origineel): ${rawBranche}`);
  }
  if (opmerkingen) lines.push(`Opmerkingen: ${opmerkingen}`);
  return lines.join("\n");
}

// ---- Main ----
async function main() {
  console.log(`\n🌞 Zonvenant Partners import — ${DRY ? "DRY RUN" : "LIVE COMMIT"}`);
  console.log(`Bestand: ${XLSX_PATH}\n`);

  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`❌ Bestand niet gevonden: ${XLSX_PATH}`);
    process.exit(1);
  }

  const wb = xlsx.readFile(XLSX_PATH);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

  const withPhone = rows.filter((r) => normalizePhone(r.Telefoonnummer));
  console.log(`Rijen totaal: ${rows.length}, met telefoonnummer: ${withPhone.length}`);

  // Pre-fetch: alle bestaande HipHot leads voor dedup
  // Efficient: één grote query
  const { data: existing, error: exErr } = await supabase
    .from("leads")
    .select("id, company_name, city, email")
    .eq("tenant", TENANT);

  if (exErr) {
    console.error("❌ Kon bestaande leads niet ophalen:", exErr.message);
    process.exit(1);
  }

  const byCompanyCity = new Map();
  const byEmail = new Map();
  for (const l of existing || []) {
    const ccKey = `${(l.company_name || "").toLowerCase().trim()}|${(l.city || "").toLowerCase().trim()}`;
    if (l.company_name) byCompanyCity.set(ccKey, l);
    if (l.email) byEmail.set(l.email.toLowerCase().trim(), l);
  }
  console.log(`Bestaande HipHot leads in DB: ${(existing || []).length}\n`);

  const toInsert = [];
  const skipped = [];
  const branchWarnings = [];

  for (const row of withPhone) {
    const company = String(row.Organisatie || "").trim();
    const city = String(row.Plaats || "").trim();
    const email = normalizeEmail(row.Email);
    const phone = normalizePhone(row.Telefoonnummer);
    const website = normalizeUrl(row.Website);
    const rawBranche = String(row.Branche || "").trim();
    const industry = mapBranche(rawBranche);
    const hoofd = String(row.Hoofdcategorie || "").trim();
    const opm = String(row.Opmerkingen || "").trim();
    const addr = parseAddress(row.Adres);

    if (!company) {
      skipped.push({ reason: "geen_organisatie", row });
      continue;
    }

    // Dedup
    const ccKey = `${company.toLowerCase()}|${city.toLowerCase()}`;
    const hitCompany = byCompanyCity.get(ccKey);
    const hitEmail = email ? byEmail.get(email) : null;
    if (hitCompany) {
      skipped.push({ reason: "duplicate_company_city", company, city, existing_id: hitCompany.id });
      continue;
    }
    if (hitEmail) {
      skipped.push({ reason: "duplicate_email", company, email, existing_id: hitEmail.id });
      continue;
    }

    if (rawBranche && !industry) {
      branchWarnings.push(rawBranche);
    }

    const leadPayload = {
      tenant: TENANT,
      company_name: company,
      contact_person: "",
      contact_first_name: "",
      contact_last_name: "",
      email,
      phone,
      website_url: website,
      address: String(row.Adres || "").trim() || null,
      city: city || null,
      billing_street: addr.street || null,
      billing_postal_code: addr.postal_code || null,
      billing_city: addr.city || city || null,
      billing_country: "NL",
      industry,
      source: SOURCE,
      status: "prospect",
      language: "nl",
    };
    const noteContent = hoofdToNote(hoofd, rawBranche, opm, rawBranche);

    // Houd beide lokaal bij — insert gebeurt in één pass hieronder
    toInsert.push({ leadPayload, noteContent });
    // Voeg toe aan dedup-maps zodat dubbele rijen binnen het bestand zelf ook
    // maar 1x worden ingevoerd
    byCompanyCity.set(ccKey, { id: "__pending__", company_name: company, city });
    if (email) byEmail.set(email, { id: "__pending__", email });
  }

  console.log(`🆕 Nieuw in te voegen: ${toInsert.length}`);
  console.log(`⏭️  Overgeslagen (duplicate/invalid): ${skipped.length}`);
  console.log(`⚠️  Branche-mismatches (industry=null, ruwe waarde in note): ${branchWarnings.length}`);
  if (branchWarnings.length) {
    const unique = [...new Set(branchWarnings)];
    console.log(`   Unieke mismatches: ${unique.join(", ")}`);
  }

  if (DRY) {
    console.log(`\n🔎 DRY RUN — geen wijzigingen. Voorbeeld-payload (eerste 3):`);
    toInsert.slice(0, 3).forEach((t, i) => {
      console.log(`\n[${i}] ${t.leadPayload.company_name}`);
      console.log(JSON.stringify(t.leadPayload, null, 2));
      console.log(`  NOTE: ${t.noteContent.replace(/\n/g, " | ")}`);
    });
    console.log(`\nRun met --commit om echt te schrijven.`);
    return;
  }

  // --- LIVE COMMIT ---
  console.log(`\n🚀 COMMITTING — ${toInsert.length} leads inserten...\n`);
  let ok = 0;
  let fail = 0;
  for (const { leadPayload, noteContent } of toInsert) {
    const { data: inserted, error: insErr } = await supabase
      .from("leads")
      .insert(leadPayload)
      .select("id, company_name")
      .single();
    if (insErr || !inserted) {
      fail++;
      console.error(`  ❌ ${leadPayload.company_name}: ${insErr?.message || "onbekend"}`);
      continue;
    }
    await supabase.from("notes").insert({
      lead_id: inserted.id,
      content: noteContent,
      note_type: "intern",
      created_by: "Zonvenant import",
      tenant: TENANT,
    });
    await supabase.from("activities").insert({
      lead_id: inserted.id,
      activity_type: "lead_created",
      description: `Lead geïmporteerd uit Zonvenant Partners lijst`,
      created_by: "Zonvenant import",
      tenant: TENANT,
    });
    ok++;
  }

  console.log(`\n✅ ${ok} toegevoegd, ${fail} gefaald. Totaal overgeslagen: ${skipped.length}.`);
  if (skipped.length > 0) {
    console.log(`\nOvergeslagen samenvatting:`);
    const bucket = {};
    for (const s of skipped) bucket[s.reason] = (bucket[s.reason] || 0) + 1;
    for (const [k, v] of Object.entries(bucket)) console.log(`  ${k}: ${v}`);
  }
}

main().catch((err) => {
  console.error("💥 Fatal:", err);
  process.exit(1);
});

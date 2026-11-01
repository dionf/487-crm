#!/usr/bin/env node
/**
 * Vult leads.logo_width / logo_height voor logo's die er al staan (migratie 045).
 *
 * Leest alleen de kop van elk logobestand voor de afmetingen; het logo zelf
 * verandert niet. Alleen rijen waar de afmetingen nog leeg zijn.
 * Standaard een droge run; met --commit wordt er geschreven.
 *
 *   node scripts/backfill-logo-dimensions.mjs [--commit] [--tenant=hiphot]
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const tenant = args.find((arg) => arg.startsWith("--tenant="))?.slice("--tenant=".length) || null;
const PAGE_SIZE = 500;
const CONCURRENCY = 8;

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ontbreken");
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchLeads() {
  const leads = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("leads")
      .select("id, tenant, company_name, logo_url")
      .not("logo_url", "is", null)
      .is("logo_width", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (tenant) query = query.eq("tenant", tenant);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    leads.push(...data);
    if (data.length < PAGE_SIZE) return leads;
  }
}

async function dimensions(logoUrl) {
  const res = await fetch(logoUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  if (!meta.width || !meta.height) throw new Error("Afmetingen onbekend");
  return { width: meta.width, height: meta.height };
}

const leads = await fetchLeads();
console.log(`${leads.length} logo's zonder afmetingen${tenant ? ` (tenant ${tenant})` : ""}${COMMIT ? "" : " — droge run"}`);

let done = 0;
let failed = 0;
let next = 0;
async function worker() {
  while (next < leads.length) {
    const lead = leads[next++];
    try {
      const { width, height } = await dimensions(lead.logo_url);
      if (COMMIT) {
        const { error } = await supabase
          .from("leads")
          .update({ logo_width: width, logo_height: height })
          .eq("id", lead.id)
          .eq("logo_url", lead.logo_url);
        if (error) throw new Error(error.message);
      }
      done += 1;
    } catch (error) {
      failed += 1;
      console.log(`MISLUKT ${lead.tenant} ${lead.company_name}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`${COMMIT ? "Bijgewerkt" : "Zou bijwerken"}: ${done}, mislukt: ${failed}`);

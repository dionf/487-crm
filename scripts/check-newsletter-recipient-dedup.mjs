#!/usr/bin/env node

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function fetchAllRows(supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("newsletter_campaign_recipients")
      .select("id, tenant, campaign_id, email")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  loadEnv(".env.local");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase env-vars ontbreken");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await fetchAllRows(supabase);
  const groups = new Map();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const key = `${row.tenant}::${row.campaign_id}::${email}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicates = [...groups.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      tenant: items[0].tenant,
      campaign_id: items[0].campaign_id,
      email: normalizeEmail(items[0].email),
      count: items.length,
      ids: items.map((item) => item.id),
    }))
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));

  const report = {
    checked_at: new Date().toISOString(),
    total_rows: rows.length,
    duplicate_groups: duplicates.length,
    duplicate_extra_rows: duplicates.reduce((sum, item) => sum + item.count - 1, 0),
    duplicates: duplicates.slice(0, 50),
  };

  console.log(JSON.stringify(report, null, 2));
  if (duplicates.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

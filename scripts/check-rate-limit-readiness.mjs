#!/usr/bin/env node

/**
 * Controleert of migratie 030 (rate limiting & anti-abuse) volledig is
 * uitgerold op het CRM Supabase-project, en geeft meteen een beeld van wat de
 * limieten de afgelopen dag hebben tegengehouden.
 *
 * Draai: npm run check:rate-limit
 *
 * Zonder deze check is een half uitgerolde migratie stil: de app valt bij een
 * ontbrekende RPC terug op de in-memory teller van de instantie en logt dat
 * alleen naar de console. Dan lijkt alles te werken terwijl de bescherming
 * tegen verspreide brute force weg is.
 */

import fs from "fs";
import os from "os";
import path from "path";

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

function getProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL of SUPABASE_PROJECT_REF ontbreekt");
  const host = new URL(supabaseUrl).host;
  return host.split(".")[0];
}

function getAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const tokenPath = path.join(os.homedir(), ".supabase", "access-token");
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, "utf8").trim();
  throw new Error("SUPABASE_ACCESS_TOKEN ontbreekt en ~/.supabase/access-token is niet gevonden");
}

async function executeSql(projectRef, token, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase query faalde (${response.status}): ${text}`);
  return JSON.parse(text);
}

const EXPECTED_TABLES = ["rate_limit_counters", "rate_limit_blocks", "api_abuse_events"];
const EXPECTED_FUNCTIONS = [
  "consume_rate_limit",
  "peek_rate_limit",
  "reset_rate_limit",
  "register_rate_limit_block",
  "rate_limit_block_status",
  "prune_rate_limit_state",
];

const CHECK_SQL = `
with expected_tables(table_name) as (
  values ${EXPECTED_TABLES.map((t) => `('${t}')`).join(", ")}
),
table_status as (
  select
    t.table_name,
    (c.oid is not null) as exists,
    coalesce(c.relrowsecurity, false) as rls_enabled
  from expected_tables t
  left join pg_class c
    on c.relname = t.table_name
   and c.relnamespace = 'public'::regnamespace
),
expected_functions(function_name) as (
  values ${EXPECTED_FUNCTIONS.map((f) => `('${f}')`).join(", ")}
),
function_status as (
  select
    f.function_name,
    (p.oid is not null) as exists,
    coalesce(p.prosecdef, false) as security_definer
  from expected_functions f
  left join pg_proc p
    on p.proname = f.function_name
   and p.pronamespace = 'public'::regnamespace
),
-- anon/authenticated mogen deze functies niet kunnen aanroepen: dan zou een
-- bezoeker zijn eigen teller kunnen resetten.
public_execute_grants as (
  select count(*)::int as grant_count
  from expected_functions f
  join pg_proc p
    on p.proname = f.function_name
   and p.pronamespace = 'public'::regnamespace
  where has_function_privilege('anon', p.oid, 'execute')
     or has_function_privilege('authenticated', p.oid, 'execute')
),
recent_abuse as (
  select
    count(*) filter (where occurred_at > now() - interval '24 hours')::int as events_24h,
    count(*) filter (where occurred_at > now() - interval '7 days')::int as events_7d,
    count(distinct ip_address) filter (where occurred_at > now() - interval '24 hours')::int as unique_ips_24h
  from public.api_abuse_events
),
top_scopes as (
  select coalesce(jsonb_agg(s), '[]'::jsonb) as scopes
  from (
    select scope, policy, count(*)::int as events
    from public.api_abuse_events
    where occurred_at > now() - interval '7 days'
    group by scope, policy
    order by count(*) desc
    limit 10
  ) s
),
active_blocks as (
  select
    count(*) filter (where blocked_until > now())::int as active,
    coalesce(max(strikes), 0)::int as max_strikes
  from public.rate_limit_blocks
),
counter_state as (
  select
    count(*)::int as total,
    count(*) filter (where expires_at <= now() - interval '1 hour')::int as prunable
  from public.rate_limit_counters
)
select
  (select count(*)::int from table_status where exists) as tables_present,
  (select count(*)::int from expected_tables) as tables_expected,
  (select count(*)::int from table_status where exists and rls_enabled) as tables_with_rls,
  (select count(*)::int from function_status where exists) as functions_present,
  (select count(*)::int from expected_functions) as functions_expected,
  (select count(*)::int from function_status where exists and security_definer) as functions_security_definer,
  (select grant_count from public_execute_grants) as public_execute_grants,
  (select events_24h from recent_abuse) as abuse_events_24h,
  (select events_7d from recent_abuse) as abuse_events_7d,
  (select unique_ips_24h from recent_abuse) as abuse_unique_ips_24h,
  (select scopes from top_scopes) as top_abuse_scopes,
  (select active from active_blocks) as active_blocks,
  (select max_strikes from active_blocks) as max_block_strikes,
  (select total from counter_state) as counter_rows,
  (select prunable from counter_state) as prunable_counter_rows
`;

function evaluate(row) {
  const failures = [];
  if (row.tables_present !== row.tables_expected) {
    failures.push(
      `Niet alle rate-limit tabellen bestaan (${row.tables_present}/${row.tables_expected}) — draai migrations/030_rate_limiting_and_abuse.sql`
    );
  }
  if (row.tables_with_rls !== row.tables_expected) {
    failures.push(`Niet alle rate-limit tabellen hebben RLS aan (${row.tables_with_rls}/${row.tables_expected})`);
  }
  if (row.functions_present !== row.functions_expected) {
    failures.push(
      `Niet alle rate-limit functies bestaan (${row.functions_present}/${row.functions_expected}) — draai migrations/030_rate_limiting_and_abuse.sql`
    );
  }
  if (row.functions_security_definer !== row.functions_expected) {
    failures.push(
      `Niet alle rate-limit functies zijn security definer (${row.functions_security_definer}/${row.functions_expected})`
    );
  }
  if (row.public_execute_grants !== 0) {
    failures.push(
      `anon/authenticated kan ${row.public_execute_grants} rate-limit functie(s) aanroepen — die rechten horen alleen bij service_role`
    );
  }
  if (row.prunable_counter_rows > 100000) {
    failures.push(
      `Er staan ${row.prunable_counter_rows} verlopen tellerrijen klaar om op te ruimen — draai select prune_rate_limit_state()`
    );
  }
  return failures;
}

async function main() {
  loadEnv(".env.local");
  const projectRef = getProjectRef();
  const token = getAccessToken();
  const [report] = await executeSql(projectRef, token, CHECK_SQL);
  const failures = evaluate(report);
  const result = {
    checked_at: new Date().toISOString(),
    project_ref: projectRef,
    ok: failures.length === 0,
    failures,
    report,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

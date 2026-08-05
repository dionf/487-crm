#!/usr/bin/env node

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

const CHECK_SQL = `
with server_tables(table_name) as (
  values
    ('quote_line_items'),
    ('organizations'),
    ('hiphot_articles'),
    ('quote_branch_texts'),
    ('email_standard_attachments'),
    ('quote_emails'),
    ('hiphot_settings'),
    ('email_templates'),
    ('quote_email_attachments'),
    ('ai_quote_lessons'),
    ('ai_quote_lesson_flags'),
    ('form_submissions'),
    ('newsletter_settings'),
    ('newsletter_segments'),
    ('newsletter_campaigns'),
    ('newsletter_campaign_recipients'),
    ('newsletter_events'),
    ('newsletter_email_suppressions')
),
server_table_status as (
  select
    t.table_name,
    coalesce(c.relrowsecurity, false) as rls_enabled
  from server_tables t
  left join pg_class c
    on c.relname = t.table_name
   and c.relnamespace = 'public'::regnamespace
),
server_table_policies as (
  select count(*)::int as policy_count
  from pg_policies p
  join server_tables t on t.table_name = p.tablename
  where p.schemaname = 'public'
),
target_views(view_name) as (
  values ('service_type_options'), ('pipeline_metrics')
),
view_status as (
  select
    v.view_name,
    coalesce('security_invoker=true' = any(c.reloptions), false) as security_invoker
  from target_views v
  left join pg_class c
    on c.relname = v.view_name
   and c.relnamespace = 'public'::regnamespace
),
normalized_email_indexes as (
  select count(*)::int as index_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'newsletter_campaign_recipients'
    and indexdef ilike '%unique%'
    and indexdef ilike '%tenant%'
    and indexdef ilike '%campaign_id%'
    and indexdef ilike '%lower%'
    and indexdef ilike '%email%'
),
newsletter_duplicate_groups as (
  select count(*)::int as duplicate_groups
  from (
    select tenant, campaign_id, lower(trim(email))
    from public.newsletter_campaign_recipients
    where email is not null and trim(email) <> ''
    group by tenant, campaign_id, lower(trim(email))
    having count(*) > 1
  ) d
),
missing_child_tenants as (
  select 'notes' as table_name, count(*)::int as missing_tenant
  from public.notes n
  join public.leads l on l.id = n.lead_id
  where n.tenant is null and l.tenant is not null
  union all
  select 'activities', count(*)::int
  from public.activities a
  join public.leads l on l.id = a.lead_id
  where a.tenant is null and l.tenant is not null
  union all
  select 'form_submissions', count(*)::int
  from public.form_submissions f
  join public.leads l on l.id = f.lead_id
  where f.tenant is null and l.tenant is not null
  union all
  select 'contacts', count(*)::int
  from public.contacts c
  join public.leads l on l.id = c.lead_id
  where c.tenant is null and l.tenant is not null
  union all
  select 'quotes', count(*)::int
  from public.quotes q
  join public.leads l on l.id = q.lead_id
  where q.tenant is null and l.tenant is not null
)
select
  (select count(*)::int from server_table_status) as expected_rls_tables,
  (select count(*)::int from server_table_status where rls_enabled) as rls_enabled_tables,
  (select coalesce(json_agg(table_name order by table_name), '[]'::json) from server_table_status where not rls_enabled) as rls_missing_tables,
  (select policy_count from server_table_policies) as server_table_policy_count,
  (select count(*)::int from view_status) as expected_security_invoker_views,
  (select count(*)::int from view_status where security_invoker) as security_invoker_views,
  (select coalesce(json_agg(view_name order by view_name), '[]'::json) from view_status where not security_invoker) as security_invoker_missing_views,
  (select index_count from normalized_email_indexes) as normalized_unique_email_indexes,
  (select duplicate_groups from newsletter_duplicate_groups) as newsletter_duplicate_groups,
  (select coalesce(sum(missing_tenant), 0)::int from missing_child_tenants) as missing_child_tenants,
  (select coalesce(json_agg(missing_child_tenants order by table_name), '[]'::json) from missing_child_tenants where missing_tenant > 0) as missing_child_tenant_tables;
`;

function evaluate(row) {
  const failures = [];
  if (row.rls_enabled_tables !== row.expected_rls_tables) {
    failures.push(`RLS staat nog niet aan op alle server-managed tabellen (${row.rls_enabled_tables}/${row.expected_rls_tables})`);
  }
  if (row.server_table_policy_count !== 0) {
    failures.push(`Server-managed tabellen hebben onverwachte policies (${row.server_table_policy_count})`);
  }
  if (row.security_invoker_views !== row.expected_security_invoker_views) {
    failures.push(`Niet alle reporting views zijn security_invoker (${row.security_invoker_views}/${row.expected_security_invoker_views})`);
  }
  if (row.normalized_unique_email_indexes < 1) {
    failures.push("Genormaliseerde unieke nieuwsbriefindex ontbreekt");
  }
  if (row.newsletter_duplicate_groups !== 0) {
    failures.push(`Er zijn dubbele nieuwsbriefontvanger-groepen (${row.newsletter_duplicate_groups})`);
  }
  if (row.missing_child_tenants !== 0) {
    failures.push(`Er zijn child-rijen zonder tenant (${row.missing_child_tenants})`);
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

# CRM security hardening uitrol

Deze checklist hoort bij de RLS/security-hardening rond PR #12.

## Volgorde na merge/deploy

1. Controleer dat de nieuwste app-versie live staat.
2. Draai `migrations/022_enable_rls_on_server_managed_tables.sql`.
   - Deze migratie backfillt eerst ontbrekende child-tenantwaarden vanuit `leads.tenant`.
   - Daarna zet hij RLS aan op server-managed tabellen.
3. Draai `migrations/023_security_invoker_views.sql`.
4. Draai eventueel `migrations/024_backfill_child_tenants_from_leads.sql` als extra idempotent vangnet.
5. Draai:

```bash
npm run check:crm:security
```

## Verwachte eindstatus

De check moet `ok: true` teruggeven.

Belangrijke onderdelen:

- alle 12 server-managed tabellen hebben RLS aan
- die tabellen hebben geen anon/auth policies
- `service_type_options` en `pipeline_metrics` zijn `security_invoker`
- genormaliseerde unieke nieuwsbriefindex bestaat
- `newsletter_duplicate_groups` is `0`
- `missing_child_tenants` is `0`

## Als de check faalt

- RLS faalt: controleer of `022` op het CRM Supabase-project is gedraaid.
- Views falen: controleer of `023` is gedraaid.
- Child-tenants falen: draai `024` opnieuw.
- Nieuwsbriefduplicates falen: niet verzenden; eerst dubbele `newsletter_campaign_recipients` opschonen.

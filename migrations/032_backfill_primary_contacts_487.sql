-- 032: Primaire contactpersonen aanmaken voor 48-7-bedrijven zonder contact.
--
-- Bij een deel van de leads staan de contactgegevens alleen op het bedrijf
-- (leads.contact_person / email / phone / contact_function) en is er geen
-- record in contacts. Daardoor ontbreekt de persoon in contactoverzichten en
-- valt de nieuwsbrief terug op leads.email. Deze backfill maakt van die
-- gegevens een primair contact, zodat contacts de bron van waarheid wordt.
--
-- Bewust alleen tenant 48-7: bij hiphot staan veel generieke adressen
-- (info@ e.d.) zonder naam; die pakken we apart op.
--
-- Idempotent: alleen leads die nog geen enkel contact hebben.

insert into contacts (lead_id, tenant, name, email, phone, role, is_primary, marketing_consent)
select
  l.id,
  l.tenant,
  coalesce(
    nullif(trim(l.contact_person), ''),
    nullif(trim(concat_ws(' ', nullif(trim(l.contact_first_name), ''), nullif(trim(l.contact_last_name), ''))), ''),
    lower(trim(l.email))
  ),
  nullif(lower(trim(l.email)), ''),
  nullif(trim(l.phone), ''),
  nullif(trim(l.contact_function), ''),
  true,
  false
from leads l
where l.tenant = '48-7'
  and (
    coalesce(trim(l.email), '') <> ''
    or coalesce(trim(l.contact_person), '') <> ''
    or coalesce(trim(l.contact_first_name), '') <> ''
  )
  and not exists (select 1 from contacts c where c.lead_id = l.id);

-- 045: Afmetingen van het bedrijfslogo.
--
-- De nieuwsbrief zette het logo neer met een vaste hoogte en een maximale
-- breedte. Een breed woordmerk (bv. 600×68) werd daardoor in de breedte
-- ingedrukt. Met de echte afmetingen rekent de mail breedte én hoogte uit
-- met behoud van verhouding; Outlook negeert max-width, dus beide moeten vast.
-- Gevuld bij uploaden/ophalen; bestaande logo's via
-- scripts/backfill-logo-dimensions.mjs. Leeg = onbekend (mail valt terug op
-- alleen een vaste hoogte).

alter table leads
  add column if not exists logo_width integer,
  add column if not exists logo_height integer;

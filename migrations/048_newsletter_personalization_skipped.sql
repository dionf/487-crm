-- 048: Een persoonlijk blok bij één bedrijf kunnen weglaten.
--
-- Naast draft (nakijken) en approved (goedgekeurd) komt skipped: het blok
-- verschijnt niet in voorbeeld, testmail, webversie of verzending, telt als
-- afgehandeld bij de goedkeuring en komt bij opnieuw genereren niet terug.
-- Alleen expliciet Vernieuwen van dat blok of "Toch tonen" zet het weer aan.
-- Additief: alleen de toegestane statussen worden ruimer.

alter table newsletter_campaign_personalizations
  drop constraint if exists newsletter_campaign_personalizations_status_check;
alter table newsletter_campaign_personalizations
  add constraint newsletter_campaign_personalizations_status_check
  check (status in ('draft', 'approved', 'skipped'));

-- 043: Tekst van het gelinkte artikel bewaren bij het nieuwsbriefitem.
--
-- De personalisatie leest het artikel achter een item mee. Dat werd bij elke
-- generatie en elke "Vernieuwen" opnieuw opgehaald, voor elk bedrijf weer.
-- Nu wordt de tekst één keer opgehaald bij het opslaan van (een nieuwe) URL en
-- hier bewaard. article_fetched_at is het tijdstip van de laatste poging.
-- Lege tekst = nog niet of niet gelukt; de personalisatie probeert het dan
-- opnieuw (na een mislukte poging pas na 6 uur) en slaat het resultaat op.

alter table newsletter_campaign_items
  add column if not exists article_text text,
  add column if not exists article_fetched_at timestamptz;

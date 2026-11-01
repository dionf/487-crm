-- 046: Formulierinzendingen blokkeren het verwijderen van een lead niet meer.
--
-- form_submissions_lead_id_fkey stond op ON DELETE NO ACTION (de tabel is
-- buiten de migraties om aangemaakt). Een lead met een formulier- of
-- chatbotinzending kon daardoor niet worden verwijderd: de DELETE gaf een
-- foreign-key-fout. Alle andere koppelingen naar leads zijn CASCADE of SET NULL.
-- De inzendingen blijven bewaard als historie; alleen lead_id wordt leeg.
-- lead_id is al nullable, dus dat hoeft hier niet.

-- Eén statement, zodat er nooit een moment is zonder koppeling.
alter table form_submissions
  drop constraint if exists form_submissions_lead_id_fkey,
  add constraint form_submissions_lead_id_fkey
  foreign key (lead_id) references leads(id) on delete set null;

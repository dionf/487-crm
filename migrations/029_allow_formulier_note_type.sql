-- 029: sta note_type 'formulier' toe
--
-- lib/constants.js biedt "Formulier" al als notitietype aan, en zowel
-- /api/public/chatbot-intake als /api/public/form-submit schrijven hun
-- intake-notitie weg met note_type = 'formulier'. De check-constraint kende
-- die waarde niet, waardoor elke intake-notitie stil faalde: 94 inzendingen
-- met een lead, nul bijbehorende notities.

alter table notes drop constraint if exists notes_note_type_check;

alter table notes add constraint notes_note_type_check
  check (note_type = any (array[
    'gesprek'::text,
    'email'::text,
    'intern'::text,
    'inventarisatie'::text,
    'todo'::text,
    'formulier'::text
  ]));

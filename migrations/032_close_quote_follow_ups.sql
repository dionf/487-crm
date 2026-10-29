-- Follow-up taken van een offerte netjes afsluiten en in de juiste tenant zetten.
--
-- De triggers op `quotes` maken automatisch een follow-up taak aan zodra een
-- offerte op 'verstuurd' komt (en een 'offerte_verlopen' taak als hij over
-- datum is). Twee problemen:
--
-- 1. Die taken werden nooit meer gesloten. Werd de offerte geaccepteerd of
--    afgewezen, dan bleef "Follow-up offerte #..." gewoon in de bel staan.
-- 2. De triggers zetten geen tenant, waardoor de kolomdefault '48-7' gold.
--    Follow-ups van HipHot-offertes kwamen zo bij de 48-7 tenant terecht.
--
-- Deze migratie:
-- - laat beide triggers de tenant van de offerte overnemen;
-- - sluit open follow-up/herinnering/verlopen-taken van een offerte zodra die
--   op 'geaccepteerd' of 'afgewezen' komt;
-- - ruimt de bestaande taken op (tenant rechtzetten, afgeronde offertes sluiten).
--
-- Taken worden per offertenummer gekoppeld via de omschrijving die de triggers
-- en /api/quotes/[id]/send-email zelf genereren. Handmatige taken en de
-- HipHot "Seizoen 2027: opnieuw benaderen" taken worden niet geraakt.

create or replace function create_quote_follow_up_task()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'verstuurd' and (OLD.status is null or OLD.status != 'verstuurd') then
    insert into follow_up_tasks (lead_id, task_type, description, due_date, tenant)
    values (
      NEW.lead_id,
      'follow_up_offerte',
      'Follow-up offerte #' || NEW.quote_number,
      now() + interval '3 days',
      NEW.tenant
    );
  end if;

  if NEW.status in ('geaccepteerd', 'afgewezen') and OLD.status is distinct from NEW.status then
    update follow_up_tasks
       set is_completed = true,
           completed_at = now()
     where lead_id = NEW.lead_id
       and is_completed = false
       and (
         (task_type = 'follow_up_offerte' and description = 'Follow-up offerte #' || NEW.quote_number)
         or (task_type = 'quote_reminder' and description = 'Offerte ' || NEW.quote_number || ' opvolgen')
         or (task_type = 'offerte_verlopen' and description = 'Offerte #' || NEW.quote_number || ' verlopen - follow-up of nieuwe offerte?')
       );
  end if;

  return NEW;
end;
$$;

create or replace function create_expired_quote_task()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'verstuurd' and NEW.valid_until < current_date then
    insert into follow_up_tasks (lead_id, task_type, description, due_date, tenant)
    select
      NEW.lead_id,
      'offerte_verlopen',
      'Offerte #' || NEW.quote_number || ' verlopen - follow-up of nieuwe offerte?',
      now(),
      NEW.tenant
    where not exists (
      select 1 from follow_up_tasks
       where lead_id = NEW.lead_id
         and task_type = 'offerte_verlopen'
         and description like '%' || NEW.quote_number || '%'
    );
  end if;
  return NEW;
end;
$$;

-- Bestaande taken in de verkeerde tenant rechtzetten.
update follow_up_tasks f
   set tenant = l.tenant
  from leads l
 where l.id = f.lead_id
   and f.tenant is distinct from l.tenant;

-- Open taken sluiten van offertes die al geaccepteerd of afgewezen zijn.
update follow_up_tasks f
   set is_completed = true,
       completed_at = coalesce(q.accepted_at, now())
  from quotes q
 where q.lead_id = f.lead_id
   and q.status in ('geaccepteerd', 'afgewezen')
   and f.is_completed = false
   and (
     (f.task_type = 'follow_up_offerte' and f.description = 'Follow-up offerte #' || q.quote_number)
     or (f.task_type = 'quote_reminder' and f.description = 'Offerte ' || q.quote_number || ' opvolgen')
     or (f.task_type = 'offerte_verlopen' and f.description = 'Offerte #' || q.quote_number || ' verlopen - follow-up of nieuwe offerte?')
   );

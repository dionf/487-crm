-- Follow-up taken krijgen de tenant van de lead, niet van de offerte.
--
-- Migratie 032 liet de triggers de tenant van de offerte overnemen. Er bestaan
-- echter offertes met tenant '48-7' op een HipHot-lead (OFT-2026-049, -059,
-- -060, -061, -062). Follow-ups van die offertes kwamen dan alsnog bij de
-- verkeerde tenant terecht. De lead is leidend, net als in de opruimactie van
-- migratie 032.
--
-- Deze migratie:
-- - laat beide triggers de tenant van de lead gebruiken;
-- - zet de tenant van offertes gelijk aan die van hun lead.

create or replace function create_quote_follow_up_task()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'verstuurd' and (OLD.status is null or OLD.status != 'verstuurd') then
    insert into follow_up_tasks (lead_id, task_type, description, due_date, tenant)
    select
      NEW.lead_id,
      'follow_up_offerte',
      'Follow-up offerte #' || NEW.quote_number,
      now() + interval '3 days',
      coalesce(l.tenant, NEW.tenant)
    from (select 1) one
    left join leads l on l.id = NEW.lead_id;
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
      coalesce(l.tenant, NEW.tenant)
    from (select 1) one
    left join leads l on l.id = NEW.lead_id
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

-- Offertes in de verkeerde tenant rechtzetten. Twee daarvan zijn verstuurd en
-- al sinds juni verlopen; zonder maatregel zou trigger_expired_quote bij deze
-- UPDATE alsnog 'offerte_verlopen' taken aanmaken. Daarom staat die trigger
-- tijdens de correctie uit.
alter table quotes disable trigger trigger_expired_quote;

update quotes q
   set tenant = l.tenant
  from leads l
 where l.id = q.lead_id
   and q.tenant is distinct from l.tenant;

alter table quotes enable trigger trigger_expired_quote;

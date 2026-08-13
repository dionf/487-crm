-- 023: Remove SECURITY DEFINER behavior from public reporting views.
--
-- Supabase flags SECURITY DEFINER views because they run with the view owner's
-- privileges instead of the querying role's privileges. These views are not used
-- by the current Next.js app routes; when they do exist, make them security
-- invoker so they respect the caller's permissions/RLS.

ALTER VIEW IF EXISTS service_type_options SET (security_invoker = true);
ALTER VIEW IF EXISTS pipeline_metrics SET (security_invoker = true);

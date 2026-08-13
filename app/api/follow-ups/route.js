import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const userId = session.user_id;
  const role = session.role;
  const { searchParams } = new URL(request.url);
  const showAll = searchParams.get("all") === "true";

  let query = supabaseAdmin
    .from("follow_up_tasks")
    .select("*, leads(company_name, contact_person, status)")
    .eq("tenant", tenant)
    .eq("is_completed", false)
    .order("due_date", { ascending: true });

  // Admin can see all tasks with ?all=true, otherwise filter to own + unassigned
  if (!(showAll && role === "admin")) {
    query = query.or(`assigned_to.eq.${userId},assigned_to.is.null`);
  }

  const { data: tasks, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tasks });
}

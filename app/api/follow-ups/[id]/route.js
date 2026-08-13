import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;
  const body = await request.json();

  // Verify task belongs to tenant
  const { data: existing } = await supabaseAdmin
    .from("follow_up_tasks").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const updates = {};
  if (body.is_completed !== undefined) {
    updates.is_completed = body.is_completed;
    if (body.is_completed) {
      updates.completed_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabaseAdmin
    .from("follow_up_tasks")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ task: data });
}

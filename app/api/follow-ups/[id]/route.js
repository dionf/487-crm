import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();

  // Verify task belongs to tenant
  const { data: existing } = await supabase
    .from("follow_up_tasks").select("tenant").eq("id", (await params).id).single();
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

  const { data, error } = await supabase
    .from("follow_up_tasks")
    .update(updates)
    .eq("id", (await params).id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ task: data });
}

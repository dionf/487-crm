import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const body = await request.json();

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
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ task: data });
}

import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

export async function PATCH(request, { params }) {
  const body = await request.json();
  const updates = {};

  if (body.name) updates.name = body.name;
  if (body.email) updates.email = body.email;
  if (body.phone !== undefined) updates.phone = body.phone || null;
  if (body.role) updates.role = body.role;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.pin) updates.pin_hash = createHash("sha256").update(body.pin).digest("hex");

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", params.id)
    .select("id, name, email, phone, role, is_active")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ user: data });
}

export async function DELETE(request, { params }) {
  // Unassign all leads from this user before deleting
  await supabase.from("leads").update({ assigned_to: null }).eq("assigned_to", params.id);
  await supabase.from("leads").update({ last_called_by: null }).eq("last_called_by", params.id);
  await supabase.from("follow_up_tasks").update({ assigned_to: null }).eq("assigned_to", params.id);

  const { error } = await supabase.from("users").delete().eq("id", params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

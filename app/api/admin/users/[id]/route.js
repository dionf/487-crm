import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

export async function PATCH(request, { params }) {
  const body = await request.json();
  const updates = {};

  if (body.name) updates.name = body.name;
  if (body.email) updates.email = body.email;
  if (body.role) updates.role = body.role;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.pin) updates.pin_hash = createHash("sha256").update(body.pin).digest("hex");

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", params.id)
    .select("id, name, email, role, is_active")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ user: data });
}

export async function DELETE(request, { params }) {
  const { error } = await supabase.from("users").delete().eq("id", params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

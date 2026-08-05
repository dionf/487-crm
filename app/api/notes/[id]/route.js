import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;
  const body = await request.json();

  // Verify note belongs to tenant
  const { data: existing } = await supabaseAdmin
    .from("notes").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Notitie niet gevonden" }, { status: 404 });
  }

  const blockedFields = new Set(["id", "tenant", "lead_id", "created_at"]);
  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (!blockedFields.has(key)) updates[key] = value;
  }

  const { data, error } = await supabaseAdmin
    .from("notes")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ note: data });
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Verify note belongs to tenant
  const { data: existing } = await supabaseAdmin
    .from("notes").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Notitie niet gevonden" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("notes").delete().eq("id", id).eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

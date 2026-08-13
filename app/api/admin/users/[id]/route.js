import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "crypto";

async function getSessionOrg(session) {
  const { data: org, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", session.tenant)
    .single();
  if (error || !org) return null;
  return org;
}

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "Alleen admins" }, { status: 403 });
  const org = await getSessionOrg(session);
  if (!org) return Response.json({ error: "Org niet gevonden" }, { status: 404 });
  const { id } = await params;
  const body = await request.json();
  const updates = {};

  if (body.name) updates.name = body.name;
  if (body.email) updates.email = body.email;
  if (body.phone !== undefined) updates.phone = body.phone || null;
  if (body.role) updates.role = body.role;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.pin) updates.pin_hash = createHash("sha256").update(body.pin).digest("hex");

  const { data, error } = await supabaseAdmin
    .from("users")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", org.id)
    .select("id, name, email, phone, role, is_active")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ user: data });
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "Alleen admins" }, { status: 403 });
  const org = await getSessionOrg(session);
  if (!org) return Response.json({ error: "Org niet gevonden" }, { status: 404 });
  const { id } = await params;

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", id)
    .eq("organization_id", org.id)
    .single();
  if (userError || !user) return Response.json({ error: "Gebruiker niet gevonden" }, { status: 404 });

  // Unassign all leads from this user before deleting
  await supabaseAdmin.from("leads").update({ assigned_to: null }).eq("tenant", session.tenant).eq("assigned_to", id);
  await supabaseAdmin.from("leads").update({ last_called_by: null }).eq("tenant", session.tenant).eq("last_called_by", id);
  await supabaseAdmin.from("follow_up_tasks").update({ assigned_to: null }).eq("tenant", session.tenant).eq("assigned_to", id);

  const { error } = await supabaseAdmin.from("users").delete().eq("id", id).eq("organization_id", org.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const body = await request.json();
  const { id } = await params;

  // Verify contact belongs to tenant
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("tenant, lead_id").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
  }

  // If setting as primary, unset other primaries
  if (body.is_primary) {
    await supabaseAdmin
      .from("contacts")
      .update({ is_primary: false })
      .eq("lead_id", existing.lead_id)
      .eq("tenant", tenant);
  }

  const blockedFields = new Set(["id", "tenant", "lead_id", "created_at"]);
  const updates = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(body)) {
    if (!blockedFields.has(key)) updates[key] = value;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Sync primary contact to lead
  if (data.is_primary) {
    const nameParts = (data.name || "").split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    await supabaseAdmin
      .from("leads")
      .update({
        contact_person: data.name,
        contact_first_name: firstName,
        contact_last_name: lastName,
        email: data.email,
        phone: data.phone,
      })
      .eq("id", data.lead_id)
      .eq("tenant", tenant);
  }

  return Response.json({ contact: data });
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Verify contact belongs to tenant
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("contacts").delete().eq("id", id).eq("tenant", tenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

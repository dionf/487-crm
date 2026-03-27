import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const { id } = params;

  // Verify contact belongs to tenant
  const { data: existing } = await supabase
    .from("contacts").select("tenant, lead_id").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
  }

  // If setting as primary, unset other primaries
  if (body.is_primary) {
    await supabase.from("contacts").update({ is_primary: false }).eq("lead_id", existing.lead_id);
  }

  const { data, error } = await supabase
    .from("contacts")
    .update({
      ...body,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Sync primary contact to lead
  if (data.is_primary) {
    await supabase
      .from("leads")
      .update({ contact_person: data.name, email: data.email, phone: data.phone })
      .eq("id", data.lead_id);
  }

  return Response.json({ contact: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  // Verify contact belongs to tenant
  const { data: existing } = await supabase
    .from("contacts").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
  }

  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

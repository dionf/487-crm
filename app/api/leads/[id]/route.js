import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  const [leadRes, quotesRes, notesRes, activitiesRes] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).eq("tenant", tenant).single(),
    supabase.from("quotes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
  ]);

  if (leadRes.error) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  return Response.json({
    lead: leadRes.data,
    quotes: quotesRes.data || [],
    notes: notesRes.data || [],
    activities: activitiesRes.data || [],
  });
}

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;
  const body = await request.json();

  // Verify lead belongs to this tenant
  const { data: existing } = await supabase
    .from("leads").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // If status is being changed to "gewonnen", set won_at
  if (body.status === "gewonnen" && !body.won_at) {
    body.won_at = new Date().toISOString();
  }

  // Sync contact_person when first/last name changes
  if (body.contact_first_name !== undefined || body.contact_last_name !== undefined) {
    const first = body.contact_first_name ?? "";
    const last = body.contact_last_name ?? "";
    body.contact_person = `${first} ${last}`.trim();
  }

  const { data, error } = await supabase
    .from("leads")
    .update(body)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ lead: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

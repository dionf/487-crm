import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  const { data, error } = await supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person, email, tenant)")
    .eq("id", id)
    .single();

  if (error || !data || data.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  return Response.json({ quote: data });
}

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;
  const body = await request.json();

  // Verify quote belongs to tenant via its lead
  const { data: quote } = await supabase
    .from("quotes").select("lead_id, leads(tenant)").eq("id", id).single();
  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  if (body.status === "verstuurd" && !body.sent_at) {
    body.sent_at = new Date().toISOString();
  }
  if (body.status === "geaccepteerd" && !body.accepted_at) {
    body.accepted_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("quotes")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ quote: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  // Verify quote belongs to tenant
  const { data: quote } = await supabase
    .from("quotes").select("lead_id, leads(tenant)").eq("id", id).single();
  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const { error } = await supabase.from("quotes").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

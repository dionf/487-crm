import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  const { data, error } = await supabaseAdmin
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
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;
  const body = await request.json();

  // Verify quote belongs to tenant via its lead
  const { data: quote } = await supabaseAdmin
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

  const blockedFields = new Set([
    "id",
    "tenant",
    "lead_id",
    "leads",
    "quote_number",
    "created_at",
    "updated_at",
  ]);
  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (!blockedFields.has(key)) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Geen velden om te wijzigen" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("quotes")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Update lead estimated_value with total of all non-rejected quotes
  await updateLeadValue(quote.lead_id, tenant);

  return Response.json({ quote: data });
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Verify quote belongs to tenant
  const { data: quote } = await supabaseAdmin
    .from("quotes").select("lead_id, leads(tenant)").eq("id", id).single();
  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("quotes").delete().eq("id", id).eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Update lead estimated_value after deletion
  await updateLeadValue(quote.lead_id, tenant);

  return Response.json({ success: true });
}

async function updateLeadValue(leadId, tenant) {
  const { data: allQuotes } = await supabaseAdmin
    .from("quotes")
    .select("amount_excl_vat")
    .eq("lead_id", leadId)
    .eq("tenant", tenant)
    .not("status", "eq", "afgewezen");

  const totalValue = (allQuotes || []).reduce((sum, q) => sum + (Number(q.amount_excl_vat) || 0), 0);
  await supabaseAdmin
    .from("leads")
    .update({ estimated_value: totalValue })
    .eq("id", leadId)
    .eq("tenant", tenant);
}

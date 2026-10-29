import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveOpportunityId, updateOpportunityValue } from "@/lib/opportunities";

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
    .from("quotes").select("lead_id, opportunity_id, leads(tenant)").eq("id", id).single();
  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // Offerte naar een ander traject van dezelfde lead verplaatsen
  if ("opportunity_id" in body) {
    body.opportunity_id = await resolveOpportunityId(quote.lead_id, tenant, body.opportunity_id);
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

  // Waarde van het traject (en bij verplaatsen ook het oude traject) bijwerken
  await updateOpportunityValue({ opportunityId: data.opportunity_id, leadId: quote.lead_id, tenant });
  if (quote.opportunity_id && quote.opportunity_id !== data.opportunity_id) {
    await updateOpportunityValue({ opportunityId: quote.opportunity_id, leadId: quote.lead_id, tenant });
  }

  return Response.json({ quote: data });
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Verify quote belongs to tenant
  const { data: quote } = await supabaseAdmin
    .from("quotes").select("lead_id, opportunity_id, leads(tenant)").eq("id", id).single();
  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("quotes").delete().eq("id", id).eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Waarde van het traject bijwerken na verwijderen
  await updateOpportunityValue({ opportunityId: quote.opportunity_id, leadId: quote.lead_id, tenant });

  return Response.json({ success: true });
}

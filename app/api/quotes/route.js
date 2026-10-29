import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveOpportunityId, updateOpportunityValue } from "@/lib/opportunities";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");

  let query = supabaseAdmin
    .from("quotes")
    .select("*, leads(company_name, contact_person), opportunities(id, name)")
    .eq("tenant", tenant)
    .order("created_at", { ascending: false });

  if (lead_id) query = query.eq("lead_id", lead_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ quotes: data });
}

export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const body = await request.json();
  const {
    lead_id, opportunity_id, amount_excl_vat, vat_percentage, description, valid_until, created_by,
    // HipHot fields
    quote_type, remarks_html, shipping_cost, shipping_discount_pct,
    margin_data, contact_name, contact_title, contact_email, contact_phone, language,
  } = body;

  if (!lead_id || !amount_excl_vat) {
    return Response.json(
      { error: "lead_id en amount_excl_vat zijn verplicht" },
      { status: 400 }
    );
  }

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, tenant")
    .eq("id", lead_id)
    .single();
  if (!lead || lead.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Generate quote number
  const { data: numData } = await supabaseAdmin.rpc("generate_quote_number");
  const quote_number = numData;

  const opportunityId = await resolveOpportunityId(lead_id, tenant, opportunity_id);

  const insertData = {
    lead_id,
    opportunity_id: opportunityId,
    quote_number,
    amount_excl_vat,
    vat_percentage: vat_percentage || 21.0,
    description: description || null,
    valid_until: valid_until || null,
    created_by: created_by || null,
    tenant,
  };

  // Add HipHot-specific fields if present
  if (quote_type) insertData.quote_type = quote_type;
  if (remarks_html) insertData.remarks_html = remarks_html;
  if (shipping_cost !== undefined) insertData.shipping_cost = shipping_cost;
  if (shipping_discount_pct !== undefined) insertData.shipping_discount_pct = shipping_discount_pct;
  if (margin_data) insertData.margin_data = margin_data;
  if (contact_name) insertData.contact_name = contact_name;
  if (contact_title) insertData.contact_title = contact_title;
  if (contact_email) insertData.contact_email = contact_email;
  if (contact_phone) insertData.contact_phone = contact_phone;
  if (language) insertData.language = language;

  const { data, error } = await supabaseAdmin
    .from("quotes")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Waarde van het traject = som van zijn offertes
  await updateOpportunityValue({ opportunityId, leadId: lead_id, tenant });

  // Log activity
  await supabaseAdmin.from("activities").insert({
    lead_id,
    activity_type: "quote_created",
    description: `Offerte ${quote_number} aangemaakt (${new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount_excl_vat)} excl. BTW)`,
    metadata: { quote_id: data.id, quote_number },
    created_by: created_by || null,
    tenant,
  });

  return Response.json({ quote: data }, { status: 201 });
}

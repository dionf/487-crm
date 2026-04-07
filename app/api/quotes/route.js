import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");

  let query = supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person)")
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
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const {
    lead_id, amount_excl_vat, vat_percentage, description, valid_until, created_by,
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

  // Generate quote number
  const { data: numData } = await supabase.rpc("generate_quote_number");
  const quote_number = numData;

  const insertData = {
    lead_id,
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

  const { data, error } = await supabase
    .from("quotes")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activities").insert({
    lead_id,
    activity_type: "quote_created",
    description: `Offerte ${quote_number} aangemaakt (${new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount_excl_vat)} excl. BTW)`,
    metadata: { quote_id: data.id, quote_number },
    created_by: created_by || null,
    tenant,
  });

  return Response.json({ quote: data }, { status: 201 });
}

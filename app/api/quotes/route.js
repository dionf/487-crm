import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");

  let query = supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person)")
    .order("created_at", { ascending: false });

  if (lead_id) query = query.eq("lead_id", lead_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ quotes: data });
}

export async function POST(request) {
  const body = await request.json();
  const { lead_id, amount_excl_vat, vat_percentage, description, valid_until, created_by } = body;

  if (!lead_id || !amount_excl_vat) {
    return Response.json(
      { error: "lead_id en amount_excl_vat zijn verplicht" },
      { status: 400 }
    );
  }

  // Generate quote number
  const { data: numData } = await supabase.rpc("generate_quote_number");
  const quote_number = numData;

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      lead_id,
      quote_number,
      amount_excl_vat,
      vat_percentage: vat_percentage || 21.0,
      description: description || null,
      valid_until: valid_until || null,
      created_by: created_by || null,
    })
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
  });

  return Response.json({ quote: data }, { status: 201 });
}

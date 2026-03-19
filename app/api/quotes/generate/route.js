import { supabase } from "@/lib/supabase";

export async function POST(request) {
  const body = await request.json();
  const { lead_id, amount_excl_vat, vat_percentage, description, valid_until, created_by } = body;

  if (!lead_id || !amount_excl_vat) {
    return Response.json({ error: "lead_id en amount_excl_vat zijn verplicht" }, { status: 400 });
  }

  // Get lead info
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", lead_id)
    .single();

  if (leadError || !lead) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Generate quote number
  const { data: quoteNumber } = await supabase.rpc("generate_quote_number");

  // Create quote record
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      lead_id,
      quote_number: quoteNumber,
      amount_excl_vat: parseFloat(amount_excl_vat),
      vat_percentage: parseFloat(vat_percentage || 21),
      description: description || null,
      valid_until: valid_until || null,
      created_by: created_by || null,
    })
    .select()
    .single();

  if (quoteError) {
    return Response.json({ error: quoteError.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activities").insert({
    lead_id,
    activity_type: "quote_created",
    description: `Offerte ${quoteNumber} aangemaakt`,
    metadata: { quote_id: quote.id, quote_number: quoteNumber, amount: amount_excl_vat },
    created_by: created_by || null,
  });

  return Response.json({ quote }, { status: 201 });
}

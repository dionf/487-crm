import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const body = await request.json();
  const { lead_id, amount_excl_vat, vat_percentage, description, valid_until, created_by } = body;

  if (!lead_id || !amount_excl_vat) {
    return Response.json({ error: "lead_id en amount_excl_vat zijn verplicht" }, { status: 400 });
  }

  // Get lead info and verify tenant
  const { data: lead, error: leadError } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("id", lead_id)
    .eq("tenant", tenant)
    .single();

  if (leadError || !lead) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Generate quote number
  const { data: quoteNumber } = await supabaseAdmin.rpc("generate_quote_number");

  // Create quote record
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("quotes")
    .insert({
      lead_id,
      quote_number: quoteNumber,
      amount_excl_vat: parseFloat(amount_excl_vat),
      vat_percentage: parseFloat(vat_percentage || 21),
      description: description || null,
      valid_until: valid_until || null,
      created_by: created_by || null,
      tenant,
    })
    .select()
    .single();

  if (quoteError) {
    return Response.json({ error: quoteError.message }, { status: 500 });
  }

  // Log activity
  await supabaseAdmin.from("activities").insert({
    lead_id,
    activity_type: "quote_created",
    description: `Offerte ${quoteNumber} aangemaakt`,
    metadata: { quote_id: quote.id, quote_number: quoteNumber, amount: amount_excl_vat },
    created_by: created_by || null,
    tenant,
  });

  return Response.json({ quote }, { status: 201 });
}

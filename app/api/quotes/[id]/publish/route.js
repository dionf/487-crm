import { supabase } from "@/lib/supabase";
import { randomBytes } from "crypto";
import { generateQuoteHtml } from "@/lib/hiphot-quote-template";
import { calculateLineTotals, calculateOrderTotals } from "@/lib/hiphot-pricing";

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json().catch(() => ({}));
  const { id } = await params;

  // Verify quote belongs to tenant
  const { data: existing } = await supabase
    .from("quotes").select("*, leads(*)").eq("id", id).single();
  if (!existing || existing.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // Keep existing hash on republish, otherwise generate new
  const hash = body.keep_hash && existing.public_hash
    ? existing.public_hash
    : randomBytes(16).toString("hex");
  const validDays = body.valid_days || 30;
  const validUntil = body.keep_hash && existing.valid_until
    ? existing.valid_until
    : new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

  const updates = {
    public_hash: hash,
    valid_until: validUntil,
  };

  // Auto-generate HTML for HipHot quotes
  if (body.generate_hiphot_html && tenant === "hiphot") {
    const { data: lineItems } = await supabase
      .from("quote_line_items")
      .select("*")
      .eq("quote_id", id)
      .order("sort_order");

    const enriched = calculateLineTotals(lineItems || []);

    // Get settings
    const { data: settingsData } = await supabase
      .from("hiphot_settings")
      .select("*")
      .eq("tenant", "hiphot")
      .single();

    const useFulfillment = existing.margin_data?.useFulfillment ?? true;
    const totals = calculateOrderTotals(enriched, settingsData || {}, useFulfillment);

    // Get branch text if specified
    const lang = body.language || existing.language || "nl";
    let branchText = null;
    if (body.branch_text_id) {
      const { data: bt } = await supabase
        .from("quote_branch_texts")
        .select("*")
        .eq("id", body.branch_text_id)
        .single();
      branchText = bt;
    }

    const introHtml = settingsData?.intro_html?.[lang] || settingsData?.intro_html?.nl || "";
    const termsHtml = settingsData?.terms_html?.[lang] || settingsData?.terms_html?.nl || "";

    updates.html_content = generateQuoteHtml({
      quote: { ...existing, valid_until: validUntil },
      lead: existing.leads || {},
      lineItems: enriched,
      totals,
      branchText,
      language: lang,
      settings: settingsData || {},
      introHtml,
      termsHtml,
    });
  }

  if (body.html_content) updates.html_content = body.html_content;
  if (body.template_type) updates.template_type = body.template_type;

  const { data, error } = await supabase
    .from("quotes")
    .update(updates)
    .eq("id", id)
    .select("*, leads(company_name)")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  if (data.lead_id) {
    await supabase.from("activities").insert({
      lead_id: data.lead_id,
      activity_type: "quote_published",
      description: `Offerte ${data.quote_number} gepubliceerd — geldig tot ${validUntil}`,
      created_by: body.created_by || "CRM",
      tenant,
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.48-7.nl";

  return Response.json({
    quote: data,
    public_url: `${baseUrl}/offerte/${hash}`,
    valid_until: validUntil,
  });
}

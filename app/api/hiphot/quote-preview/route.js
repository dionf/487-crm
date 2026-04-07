import { generateQuoteHtml } from "@/lib/hiphot-quote-template";
import { supabase } from "@/lib/supabase";

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const body = await request.json();
  const { lead, items, totals, branchText, language, remarksHtml, contactName, contactEmail, contactPhone } = body;

  // Pull intro/terms from settings for preview
  const { data: settings } = await supabase
    .from("hiphot_settings")
    .select("*")
    .eq("tenant", "hiphot")
    .single();

  const lang = language || "nl";
  const introHtml = settings?.intro_html?.[lang] || settings?.intro_html?.nl || "";
  const termsHtml = settings?.terms_html?.[lang] || settings?.terms_html?.nl || "";

  const html = generateQuoteHtml({
    quote: {
      quote_number: "PREVIEW",
      created_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      remarks_html: remarksHtml,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
    },
    lead: lead || {},
    lineItems: items || [],
    totals: totals || {},
    branchText: branchText || null,
    language: lang,
    settings: settings || {},
    introHtml,
    termsHtml,
  });

  return Response.json({ html });
}

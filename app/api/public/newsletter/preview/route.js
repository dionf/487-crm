import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchCampaignItems, fetchCampaignPersonalizations } from "@/lib/newsletter-personalize";
import { renderPersonalizedNewsletter } from "@/lib/newsletter-render";
import { previewUnsubscribeUrl } from "@/lib/newsletter-unsubscribe";
import { verifyPreviewSignature } from "@/lib/newsletter-preview-link";

export const dynamic = "force-dynamic";

function notFound() {
  return new Response("Deze nieuwsbrief is niet (meer) beschikbaar.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Webversie van een gepersonaliseerde nieuwsbrief: ?c=campagne&l=bedrijf&s=handtekening.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("c");
  const leadId = searchParams.get("l");
  if (!verifyPreviewSignature(campaignId, leadId, searchParams.get("s"))) return notFound();

  const { data: campaign } = await supabaseAdmin
    .from("newsletter_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("mode", "personalized")
    .maybeSingle();
  if (!campaign) return notFound();
  const { data: company } = await supabaseAdmin
    .from("leads")
    .select("id, company_name, logo_url")
    .eq("id", leadId)
    .eq("tenant", campaign.tenant)
    .maybeSingle();
  if (!company) return notFound();

  const [items, slots] = await Promise.all([
    fetchCampaignItems(campaign.tenant, campaign.id),
    fetchCampaignPersonalizations(campaign.tenant, campaign.id, [company.id]),
  ]);
  if (!items.length) return notFound();

  const { html } = renderPersonalizedNewsletter({
    campaign,
    items,
    slots,
    company,
    unsubscribeUrl: previewUnsubscribeUrl(),
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

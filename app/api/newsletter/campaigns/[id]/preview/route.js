import { requireAdmin } from "@/lib/newsletters";
import {
  fetchCampaignCompanies,
  fetchCampaignItems,
  fetchCampaignPersonalizations,
  getPersonalizedCampaign,
} from "@/lib/newsletter-personalize";
import { renderPersonalizedNewsletter } from "@/lib/newsletter-render";
import { buildPreviewUrl } from "@/lib/newsletter-preview-link";

export const dynamic = "force-dynamic";

// Volledige mail zoals één bedrijf hem krijgt: ?lead_id=...
// Met ?format=html komt de pure HTML terug (voor een iframe).
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get("lead_id");
    const campaign = await getPersonalizedCampaign(tenant, id);
    const companies = await fetchCampaignCompanies(tenant, campaign, { includeSamples: true });
    const company = leadId ? companies.find((candidate) => candidate.id === leadId) : companies[0];
    if (!company) return Response.json({ error: "Geen ontvangend bedrijf gevonden" }, { status: 404 });

    const [items, slots] = await Promise.all([
      fetchCampaignItems(tenant, id),
      fetchCampaignPersonalizations(tenant, id, [company.id]),
    ]);
    const previewUrl = buildPreviewUrl(campaign.id, company.id);
    const rendered = renderPersonalizedNewsletter({
      campaign,
      items,
      slots,
      company,
      recipient: company.recipients[0],
      unsubscribeUrl: "#",
      webVersionUrl: previewUrl,
    });

    if (searchParams.get("format") === "html") {
      return new Response(rendered.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.json({ lead_id: company.id, company_name: company.company_name, sample: company.sample, preview_url: previewUrl, ...rendered });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

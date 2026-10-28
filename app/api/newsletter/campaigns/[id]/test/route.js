import { getCampaignForTenant, requireAdmin, sendTestEmail } from "@/lib/newsletters";
import { sendPersonalizedTestEmail } from "@/lib/newsletter-personalized-send";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const campaign = await getCampaignForTenant(tenant, id);
    if (["sent", "scheduled", "syncing"].includes(campaign.status)) {
      return Response.json({ error: "Deze campagne kan niet meer als test worden verstuurd" }, { status: 400 });
    }
    const updated = campaign.mode === "personalized"
      ? await sendPersonalizedTestEmail({ tenant, campaign, leadId: body.lead_id, toEmail: body.to, userName })
      : await sendTestEmail({ tenant, campaign, toEmail: body.to, userName });
    return Response.json({ campaign: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

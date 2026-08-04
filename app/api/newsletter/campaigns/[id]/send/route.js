import { getCampaignForTenant, requireAdmin, syncAndSendCampaign } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getCampaignForTenant(tenant, id);
    if (["sent", "scheduled", "syncing"].includes(campaign.status)) {
      return Response.json({ error: "Deze campagne is al verzonden of wordt verwerkt" }, { status: 400 });
    }
    const updated = await syncAndSendCampaign({ tenant, campaign, userName });
    return Response.json({ campaign: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

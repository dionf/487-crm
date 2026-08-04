import { buildRecipientsForCampaign, getCampaignForTenant, requireAdmin } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getCampaignForTenant(tenant, id);
    const recipients = await buildRecipientsForCampaign(tenant, campaign.segment_id, campaign.excluded_segment_ids);
    return Response.json({
      count: recipients.length,
      recipients: recipients.slice(0, 250),
      truncated: recipients.length > 250,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

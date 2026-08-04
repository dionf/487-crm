import { buildRecipientsForCampaign, getCampaignForTenant, requireAdmin } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getCampaignForTenant(tenant, id);
    const result = await buildRecipientsForCampaign(
      tenant,
      campaign.segment_id,
      campaign.excluded_segment_ids,
      campaign.recipient_limit
    );
    return Response.json({
      count: result.recipients.length,
      total_count: result.total_count,
      recipient_limit: result.limit,
      limited: result.limited,
      recipients: result.recipients.slice(0, 250),
      truncated: result.recipients.length > 250,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

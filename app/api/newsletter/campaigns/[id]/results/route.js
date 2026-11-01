import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  calculateCampaignResults,
  getCampaignForTenant,
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
  requireAdmin,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

const RECIPIENT_PAGE = 250;

// Resultaat van een verzonden (of lopende) campagne: uitkomsten uit de
// webhook-events en de werkelijke ontvangers, niet de huidige doelgroep.
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    // Onbekend of van een andere tenant: 404, net als GET op de campagne zelf.
    const campaign = await getCampaignForTenant(tenant, id).catch(() => null);
    if (!campaign) return Response.json({ error: "Campagne niet gevonden" }, { status: 404 });
    const [results, recipientsResult] = await Promise.all([
      calculateCampaignResults(tenant, campaign),
      supabaseAdmin
        .from("newsletter_campaign_recipients")
        .select("email, name, company_name, status", { count: "exact" })
        .eq("tenant", tenant)
        .eq("campaign_id", campaign.id)
        .order("email")
        .limit(RECIPIENT_PAGE),
    ]);
    if (recipientsResult.error) throw new Error(recipientsResult.error.message);
    const total = recipientsResult.count ?? recipientsResult.data.length;
    return Response.json({
      ...results,
      recipients: recipientsResult.data || [],
      recipients_total: total,
      truncated: total > RECIPIENT_PAGE,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

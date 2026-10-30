import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import { getPersonalizedCampaign, updateCampaignSamples } from "@/lib/newsletter-personalize";

export const dynamic = "force-dynamic";

// Bedrijven die je als voorbeeld kunt kiezen (alle bedrijven van de tenant).
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id);
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id, company_name, logo_url, newsletter_profile_status")
      .eq("tenant", tenant)
      .order("company_name");
    if (error) throw new Error(error.message);
    return Response.json({ sample_lead_ids: campaign.sample_lead_ids || [], companies: data || [] });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// { add: lead_id } of { remove: lead_id }
export async function POST(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    if (!body.add && !body.remove) throw new Error("Geef add of remove");
    const updated = await updateCampaignSamples(tenant, campaign, { add: body.add, remove: body.remove });
    return Response.json({ campaign: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

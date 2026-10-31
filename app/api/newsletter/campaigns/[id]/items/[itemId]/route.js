import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import {
  articleFields,
  getPersonalizedCampaign,
  invalidateCampaignApprovals,
  itemSlot,
  normalizeItemInput,
} from "@/lib/newsletter-personalize";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id, itemId } = await params;
    await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    const patch = { ...normalizeItemInput(body, { partial: true }), updated_at: new Date().toISOString() };
    // Het formulier stuurt de URL altijd mee; alleen een andere URL wordt opnieuw gelezen.
    if ("url" in patch) {
      const { data: current, error: currentError } = await supabaseAdmin
        .from("newsletter_campaign_items")
        .select("url")
        .eq("tenant", tenant)
        .eq("campaign_id", id)
        .eq("id", itemId)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) return Response.json({ error: "Item niet gevonden" }, { status: 404 });
      if (current.url !== patch.url) Object.assign(patch, await articleFields(patch.url));
    }
    const { data, error } = await supabaseAdmin
      .from("newsletter_campaign_items")
      .update(patch)
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("id", itemId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return Response.json({ error: "Item niet gevonden" }, { status: 404 });
    // Alleen een volgordewijziging verandert niets aan de inhoud.
    if (Object.keys(patch).some((key) => !["sort_order", "updated_at"].includes(key))) {
      await invalidateCampaignApprovals(tenant, id);
    }
    return Response.json({ item: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id, itemId } = await params;
    await getPersonalizedCampaign(tenant, id, { editable: true });
    const { error } = await supabaseAdmin
      .from("newsletter_campaign_items")
      .delete()
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("id", itemId);
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("newsletter_campaign_personalizations")
      .delete()
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("slot", itemSlot(itemId));
    await invalidateCampaignApprovals(tenant, id);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

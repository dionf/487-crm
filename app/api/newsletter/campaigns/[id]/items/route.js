import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import {
  articleFields,
  fetchCampaignItems,
  getPersonalizedCampaign,
  invalidateCampaignApprovals,
  normalizeItemInput,
} from "@/lib/newsletter-personalize";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    await getPersonalizedCampaign(tenant, id);
    // De bewaarde artikeltekst is alleen voor de personalisatie, niet voor de editor.
    const items = await fetchCampaignItems(tenant, id);
    return Response.json({ items: items.map(({ article_text, ...item }) => item) });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    const item = normalizeItemInput(body);
    if (!("sort_order" in item)) {
      const existing = await fetchCampaignItems(tenant, id);
      item.sort_order = existing.filter((other) => other.section === item.section).length;
    }
    if (item.url) Object.assign(item, await articleFields(item.url));
    const { data, error } = await supabaseAdmin
      .from("newsletter_campaign_items")
      .insert({ ...item, tenant, campaign_id: id })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await invalidateCampaignApprovals(tenant, id);
    return Response.json({ item: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

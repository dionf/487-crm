import { requireAdmin } from "@/lib/newsletters";
import { getPersonalizedCampaign } from "@/lib/newsletter-personalize";
import { fetchCampaignItem, fetchCampaignSocialPosts, generateSocialPost } from "@/lib/newsletter-social";
import { SOCIAL_CHANNEL_IDS } from "@/lib/newsletter-social-shared";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Social posts van deze editie. Ook na verzending: het team plaatst ze daarna.
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    await getPersonalizedCampaign(tenant, id);
    return Response.json({ posts: await fetchCampaignSocialPosts(tenant, id) });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Genereert (opnieuw) één post: { item_id, channel }.
// De UI loopt zelf over de gekozen posts, zodat één request binnen de timeout blijft.
export async function POST(request, { params }) {
  try {
    const { tenant, userId, userName } = requireAdmin(request);
    const gate = await enforceRateLimit({
      request,
      policy: "session-expensive",
      identifier: userId,
      scope: "/api/newsletter/social-posts",
      tenant,
    });
    if (gate.response) return gate.response;

    const { id } = await params;
    await getPersonalizedCampaign(tenant, id);
    const body = await request.json();
    if (!SOCIAL_CHANNEL_IDS.includes(body.channel)) return Response.json({ error: "Onbekend kanaal" }, { status: 400 });
    if (!body.item_id) return Response.json({ error: "item_id is verplicht" }, { status: 400 });
    const item = await fetchCampaignItem(tenant, id, body.item_id);
    if (!item) return Response.json({ error: "Item niet gevonden" }, { status: 404 });

    const post = await generateSocialPost(tenant, id, item, body.channel, userName);
    return Response.json({ post });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: `Post maken mislukt: ${error.message}` }, { status: 502 });
  }
}

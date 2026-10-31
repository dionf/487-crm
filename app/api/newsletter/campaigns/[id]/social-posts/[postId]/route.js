import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import { getPersonalizedCampaign } from "@/lib/newsletter-personalize";
import { normalizeSocialContent } from "@/lib/newsletter-social-shared";

export const dynamic = "force-dynamic";

// Bewerkte tekst opslaan: { content }.
export async function PATCH(request, { params }) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const { id, postId } = await params;
    await getPersonalizedCampaign(tenant, id);
    const body = await request.json();
    const { data: current, error: currentError } = await supabaseAdmin
      .from("newsletter_campaign_social_posts")
      .select("channel")
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("id", postId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) return Response.json({ error: "Post niet gevonden" }, { status: 404 });

    const content = normalizeSocialContent(current.channel, body.content || {});
    const { data, error } = await supabaseAdmin
      .from("newsletter_campaign_social_posts")
      .update({ content, edited_by: userName, updated_at: new Date().toISOString() })
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("id", postId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return Response.json({ error: "Post niet gevonden" }, { status: 404 });
    return Response.json({ post: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id, postId } = await params;
    await getPersonalizedCampaign(tenant, id);
    const { error } = await supabaseAdmin
      .from("newsletter_campaign_social_posts")
      .delete()
      .eq("tenant", tenant)
      .eq("campaign_id", id)
      .eq("id", postId);
    if (error) throw new Error(error.message);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

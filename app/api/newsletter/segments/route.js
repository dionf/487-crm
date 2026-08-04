import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
  requireAdmin,
  sanitizeSlug,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

const SOURCE_TYPES = new Set([
  "all_marketing",
  "marketing_segment",
  "without_marketing_segments",
  "lead_status",
  "relationship_type",
  "hubspot_deal_origin",
  "industry",
  "recipient_email_contains",
]);

export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const { data, error } = await supabaseAdmin
      .from("newsletter_segments")
      .select("*")
      .eq("tenant", tenant)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return Response.json({ segments: data || [] });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { tenant } = requireAdmin(request);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const sourceType = SOURCE_TYPES.has(body.source_type) ? body.source_type : "all_marketing";
    if (!name) return Response.json({ error: "Naam is verplicht" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("newsletter_segments")
      .insert({
        tenant,
        name,
        slug: sanitizeSlug(body.slug || name),
        source_type: sourceType,
        source_value: body.source_value || null,
        sort_order: Number(body.sort_order || 100),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ segment: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const { tenant } = requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Segment-ID ontbreekt" }, { status: 400 });

    const { data: segment, error: segmentError } = await supabaseAdmin
      .from("newsletter_segments")
      .select("id, name, default_excluded")
      .eq("tenant", tenant)
      .eq("id", id)
      .single();
    if (segmentError || !segment) return Response.json({ error: "Segment niet gevonden" }, { status: 404 });
    if (segment.default_excluded) {
      return Response.json({ error: "Standaard uitsluitsegmenten kunnen niet worden verwijderd" }, { status: 400 });
    }

    const mutableStatuses = ["draft", "tested", "failed"];
    const { error: clearDirectError } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ segment_id: null, status: "draft", test_sent_at: null, updated_at: new Date().toISOString() })
      .eq("tenant", tenant)
      .eq("segment_id", id)
      .in("status", mutableStatuses);
    if (clearDirectError) throw new Error(clearDirectError.message);

    const { data: excludedCampaigns, error: excludedError } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("id, excluded_segment_ids")
      .eq("tenant", tenant)
      .contains("excluded_segment_ids", [id])
      .in("status", mutableStatuses);
    if (excludedError) throw new Error(excludedError.message);

    for (const campaign of excludedCampaigns || []) {
      const nextExcluded = (campaign.excluded_segment_ids || []).filter((segmentId) => segmentId !== id);
      const { error: updateCampaignError } = await supabaseAdmin
        .from("newsletter_campaigns")
        .update({
          excluded_segment_ids: nextExcluded,
          status: "draft",
          test_sent_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant", tenant)
        .eq("id", campaign.id);
      if (updateCampaignError) throw new Error(updateCampaignError.message);
    }

    const { data, error } = await supabaseAdmin
      .from("newsletter_segments")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant", tenant)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ segment: data, removed_from_campaigns: excludedCampaigns?.length || 0 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}

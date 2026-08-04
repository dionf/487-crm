import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
  reconcileScheduledBroadcasts,
  requireAdmin,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

function normalizeSegmentIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
}

function normalizeScheduledAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Geplande verzenddatum is ongeldig");
  return date.toISOString();
}

async function validateSegments(tenant, ids) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("newsletter_segments")
    .select("id, source_type")
    .eq("tenant", tenant)
    .in("id", ids);
  if (error) throw new Error(error.message);
  if ((data || []).length !== ids.length) {
    throw new Error("Een of meer uitsluitsegmenten horen niet bij deze tenant");
  }
  return data || [];
}

function sameSegmentRule(a, b) {
  if (!a || !b) return false;
  return (
    a.source_type === b.source_type &&
    String(a.source_value || "").trim().toLowerCase() === String(b.source_value || "").trim().toLowerCase()
  );
}

async function cleanExcludedSegmentIds(tenant, ids, includeSegment) {
  const normalized = normalizeSegmentIds(ids);
  const segments = await validateSegments(tenant, normalized);
  const allowed = new Set(
    segments
      .filter((segment) => segment.source_type !== "all_marketing" && segment.id !== includeSegment?.id && !sameSegmentRule(segment, includeSegment))
      .map((segment) => segment.id)
  );
  return normalized.filter((id) => allowed.has(id));
}

export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const { data, error } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("*, newsletter_segments(name, slug)")
      .eq("tenant", tenant)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const campaigns = await reconcileScheduledBroadcasts(tenant, data || []);
    return Response.json({ campaigns });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const body = await request.json();
    const name = String(body.name || body.subject || "").trim();
    const subject = String(body.subject || "").trim();
    const bodyHtml = String(body.body_html || "").trim();
    const scheduledAt = normalizeScheduledAt(body.scheduled_at);
    if (!name || !subject || !bodyHtml) {
      return Response.json({ error: "Naam, onderwerp en HTML zijn verplicht" }, { status: 400 });
    }

    let includeSegment = null;
    if (body.segment_id) {
      const { data: segment } = await supabaseAdmin
        .from("newsletter_segments")
        .select("id, source_type, source_value")
        .eq("tenant", tenant)
        .eq("id", body.segment_id)
        .single();
      if (!segment) return Response.json({ error: "Segment niet gevonden" }, { status: 404 });
      includeSegment = segment;
    }
    const excludedSegmentIds = await cleanExcludedSegmentIds(tenant, body.excluded_segment_ids, includeSegment);

    const { data, error } = await supabaseAdmin
      .from("newsletter_campaigns")
      .insert({
        tenant,
        segment_id: body.segment_id || null,
        excluded_segment_ids: excludedSegmentIds,
        name,
        subject,
        preview_text: body.preview_text || null,
        body_html: bodyHtml,
        scheduled_at: scheduledAt,
        created_by: userName,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ campaign: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getCampaignForTenant,
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
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

function normalizeText(value) {
  return String(value || "").trim();
}

function sameIdList(a, b) {
  const left = normalizeSegmentIds(a).sort();
  const right = normalizeSegmentIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
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

async function validateSegment(tenant, id) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("newsletter_segments")
    .select("id, source_type, source_value")
    .eq("tenant", tenant)
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Segment niet gevonden");
  return data;
}

export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getCampaignForTenant(tenant, id);
    return Response.json({ campaign });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 404 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const currentCampaign = await getCampaignForTenant(tenant, id);
    const patch = {
      updated_at: new Date().toISOString(),
    };
    for (const field of ["name", "subject", "preview_text", "body_html", "segment_id"]) {
      if (field in body) patch[field] = body[field] || null;
    }
    if ("scheduled_at" in body) patch.scheduled_at = normalizeScheduledAt(body.scheduled_at);
    const patchedIncludeSegment = "segment_id" in patch ? await validateSegment(tenant, patch.segment_id) : null;
    if ("excluded_segment_ids" in body) {
      const includeSegment = "segment_id" in patch ? patchedIncludeSegment : currentCampaign.newsletter_segments || null;
      patch.excluded_segment_ids = await cleanExcludedSegmentIds(tenant, body.excluded_segment_ids, includeSegment);
    }
    if (patch.body_html === null || patch.subject === null || patch.name === null) {
      return Response.json({ error: "Naam, onderwerp en HTML mogen niet leeg zijn" }, { status: 400 });
    }

    const approvalBreakingChange =
      ("subject" in patch && normalizeText(patch.subject) !== normalizeText(currentCampaign.subject)) ||
      ("preview_text" in patch && normalizeText(patch.preview_text) !== normalizeText(currentCampaign.preview_text)) ||
      ("body_html" in patch && normalizeText(patch.body_html) !== normalizeText(currentCampaign.body_html)) ||
      ("segment_id" in patch && String(patch.segment_id || "") !== String(currentCampaign.segment_id || "")) ||
      ("excluded_segment_ids" in patch && !sameIdList(patch.excluded_segment_ids, currentCampaign.excluded_segment_ids));

    if (approvalBreakingChange) {
      patch.status = "draft";
      patch.test_sent_at = null;
      patch.approved_at = null;
      patch.approved_by = null;
    }

    const { data, error } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update(patch)
      .eq("tenant", tenant)
      .eq("id", id)
      .in("status", ["draft", "tested", "failed"])
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return Response.json(
        { error: "Alleen concept-, test- en mislukte campagnes kunnen worden bewerkt" },
        { status: 400 }
      );
    }
    return Response.json({ campaign: data });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("newsletter_campaigns")
      .delete()
      .eq("tenant", tenant)
      .eq("id", id)
      .in("status", ["draft", "tested", "failed"])
      .select("id")
      .single();
    if (error || !data) {
      return Response.json(
        { error: "Alleen concept-, test- en mislukte campagnes kunnen worden verwijderd" },
        { status: 400 }
      );
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}

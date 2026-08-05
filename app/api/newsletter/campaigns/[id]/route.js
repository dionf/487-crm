import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getCampaignForTenant,
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
  normalizeBatchSettings,
  normalizeRecipientLimit,
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

async function validateSegments(tenant, ids, label = "segmenten") {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("newsletter_segments")
    .select("id, source_type, source_value, default_excluded")
    .eq("tenant", tenant)
    .in("id", ids);
  if (error) throw new Error(error.message);
  if ((data || []).length !== ids.length) {
    throw new Error(`Een of meer ${label} horen niet bij deze tenant`);
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

async function cleanExcludedSegmentIds(tenant, ids, includeSegments = []) {
  const normalized = normalizeSegmentIds(ids);
  const segments = await validateSegments(tenant, normalized);
  const allowed = new Set(
    segments
      .filter((segment) => (
        segment.source_type !== "all_marketing" &&
        !includeSegments.some((includeSegment) => segment.id === includeSegment.id || sameSegmentRule(segment, includeSegment))
      ))
      .map((segment) => segment.id)
  );
  return normalized.filter((id) => allowed.has(id));
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
    for (const field of ["name", "subject", "preview_text", "body_html"]) {
      if (field in body) patch[field] = body[field] || null;
    }
    let includeSegments = null;
    if ("included_segment_ids" in body || "segment_id" in body) {
      const includedSegmentIds = normalizeSegmentIds(body.included_segment_ids || (body.segment_id ? [body.segment_id] : []));
      if (!includedSegmentIds.length) {
        return Response.json({ error: "Kies minimaal een doelgroep voor deze campagne" }, { status: 400 });
      }
      includeSegments = await validateSegments(tenant, includedSegmentIds, "doelgroepen");
      if (includeSegments.some((segment) => segment.default_excluded)) {
        return Response.json({ error: "Standaard uitsluitsegmenten kunnen niet als doelgroep worden gebruikt" }, { status: 400 });
      }
      patch.included_segment_ids = includedSegmentIds;
      patch.segment_id = includedSegmentIds[0] || null;
    }
    if ("recipient_limit" in body) patch.recipient_limit = normalizeRecipientLimit(body.recipient_limit);
    if (
      "batch_mode" in body ||
      "batch_size" in body ||
      "batch_wait_hours" in body ||
      "max_bounce_rate" in body ||
      "max_complaint_rate" in body ||
      "max_failed_rate" in body ||
      "max_unsubscribe_rate" in body
    ) {
      Object.assign(patch, normalizeBatchSettings({
        batch_mode: "batch_mode" in body ? body.batch_mode : currentCampaign.batch_mode,
        batch_size: "batch_size" in body ? body.batch_size : currentCampaign.batch_size,
        batch_wait_hours: "batch_wait_hours" in body ? body.batch_wait_hours : currentCampaign.batch_wait_hours,
        max_bounce_rate: "max_bounce_rate" in body ? body.max_bounce_rate : currentCampaign.max_bounce_rate,
        max_complaint_rate: "max_complaint_rate" in body ? body.max_complaint_rate : currentCampaign.max_complaint_rate,
        max_failed_rate: "max_failed_rate" in body ? body.max_failed_rate : currentCampaign.max_failed_rate,
        max_unsubscribe_rate: "max_unsubscribe_rate" in body ? body.max_unsubscribe_rate : currentCampaign.max_unsubscribe_rate,
      }));
    }
    if ("scheduled_at" in body) patch.scheduled_at = normalizeScheduledAt(body.scheduled_at);
    if ("excluded_segment_ids" in body) {
      const currentIncludedIds = normalizeSegmentIds(currentCampaign.included_segment_ids || (currentCampaign.segment_id ? [currentCampaign.segment_id] : []));
      const effectiveIncludeSegments = includeSegments || await validateSegments(tenant, currentIncludedIds, "doelgroepen");
      patch.excluded_segment_ids = await cleanExcludedSegmentIds(tenant, body.excluded_segment_ids, effectiveIncludeSegments);
    }
    if (patch.body_html === null || patch.subject === null || patch.name === null) {
      return Response.json({ error: "Naam, onderwerp en HTML mogen niet leeg zijn" }, { status: 400 });
    }

    const approvalBreakingChange =
      ("subject" in patch && normalizeText(patch.subject) !== normalizeText(currentCampaign.subject)) ||
      ("preview_text" in patch && normalizeText(patch.preview_text) !== normalizeText(currentCampaign.preview_text)) ||
      ("body_html" in patch && normalizeText(patch.body_html) !== normalizeText(currentCampaign.body_html)) ||
      ("included_segment_ids" in patch && !sameIdList(patch.included_segment_ids, currentCampaign.included_segment_ids || (currentCampaign.segment_id ? [currentCampaign.segment_id] : []))) ||
      ("recipient_limit" in patch && Number(patch.recipient_limit || 0) !== Number(currentCampaign.recipient_limit || 0)) ||
      ("batch_mode" in patch && patch.batch_mode !== currentCampaign.batch_mode) ||
      ("batch_size" in patch && Number(patch.batch_size || 0) !== Number(currentCampaign.batch_size || 0)) ||
      ("batch_wait_hours" in patch && Number(patch.batch_wait_hours || 0) !== Number(currentCampaign.batch_wait_hours || 0)) ||
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

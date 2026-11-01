// Doelgroepregels voor nieuwsbriefcampagnes (welke segmenten je kunt kiezen
// en uitsluiten). Zonder serverimports, dus ook bruikbaar in de browser.

export const SOURCE_TYPES = [
  { id: "all_marketing", label: "Alle marketingcontacten" },
  { id: "marketing_segment", label: "Marketingsegment bevat" },
  { id: "without_marketing_segments", label: "Zonder marketingsegmenten" },
  { id: "lead_status", label: "Leadstatus is" },
  { id: "relationship_type", label: "Relatietype is" },
  { id: "hubspot_deal_origin", label: "HubSpot-herkomst is" },
  { id: "industry", label: "Branche is" },
  { id: "recipient_email_in", label: "Exacte ontvanger e-mails" },
  { id: "recipient_email_contains", label: "Ontvanger e-mail bevat" },
  { id: "recent_order_days", label: "Recent besteld binnen dagen" },
];

export function sourceTypeLabel(sourceType) {
  return SOURCE_TYPES.find((type) => type.id === sourceType)?.label || sourceType;
}

export function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
}

export function campaignTargetIds(campaign) {
  const ids = normalizeIds(campaign?.included_segment_ids || []);
  if (ids.length) return ids;
  return campaign?.segment_id ? [campaign.segment_id] : [];
}

export function sameIdList(a, b) {
  const left = normalizeIds(a).sort();
  const right = normalizeIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameSegmentRule(a, b) {
  if (!a || !b) return false;
  return (
    a.source_type === b.source_type &&
    String(a.source_value || "").trim().toLowerCase() === String(b.source_value || "").trim().toLowerCase()
  );
}

export function segmentCanExclude(segment, includeSegments = []) {
  if (!segment || segment.source_type === "all_marketing") return false;
  if (includeSegments.some((includeSegment) => segment.id === includeSegment.id || sameSegmentRule(segment, includeSegment))) return false;
  if (includeSegments.some((includeSegment) => includeSegment.source_type === "recipient_email_contains") && !segment.default_excluded) {
    return segment.source_type === "recipient_email_contains";
  }
  return true;
}

export function targetSegmentNames(campaign, segments) {
  const ids = campaignTargetIds(campaign);
  if (!ids.length) return ["Alle marketingcontacten"];
  return ids.map((id) => segments.find((segment) => segment.id === id)?.name).filter(Boolean);
}

export function excludedSegmentNames(campaign, segments) {
  const defaultExcluded = segments.filter((segment) => segment.default_excluded).map((segment) => segment.id);
  const ids = new Set([...(campaign.excluded_segment_ids || []), ...defaultExcluded]);
  const includeSegments = campaignTargetIds(campaign).map((id) => segments.find((item) => item.id === id)).filter(Boolean);
  return segments
    .filter((segment) => ids.has(segment.id))
    .filter((segment) => segmentCanExclude(segment, includeSegments))
    .map((segment) => segment.name);
}

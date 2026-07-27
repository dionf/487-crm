export const HIPHOT_MARKETING_SEGMENTS = [
  { id: "algemene_nieuwsbrief", label: "Algemene nieuwsbrief" },
  { id: "factor_30", label: "Factor 30" },
  { id: "factor_50", label: "Factor 50" },
  { id: "klant", label: "Klant" },
  { id: "prospect", label: "Prospect" },
  { id: "event_recreatie", label: "Event/recreatie" },
  { id: "outdoor_werk", label: "Outdoor werk" },
];

export const HIPHOT_MARKETING_STATUSES = [
  { id: "unknown", label: "Onbekend" },
  { id: "subscribed", label: "Ingeschreven" },
  { id: "unsubscribed", label: "Uitgeschreven" },
  { id: "hard_bounce", label: "Hard bounce" },
  { id: "non_marketing", label: "Geen marketingcontact" },
];

export function marketingStatusLabel(status) {
  return HIPHOT_MARKETING_STATUSES.find((s) => s.id === status)?.label || status || "Onbekend";
}

export function marketingSegmentLabels(segmentIds = []) {
  const labels = new Map(HIPHOT_MARKETING_SEGMENTS.map((s) => [s.id, s.label]));
  return (segmentIds || []).map((id) => labels.get(id) || id);
}

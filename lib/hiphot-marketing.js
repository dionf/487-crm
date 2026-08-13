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

export const HIPHOT_RELATION_TYPES = [
  { id: "customer", label: "Klant" },
  { id: "mail_contact", label: "Mailcontact" },
  { id: "newsletter_contact", label: "Nieuwsbriefcontact" },
  { id: "website_activity", label: "Website/formulier" },
  { id: "hubspot_record", label: "Alleen HubSpot-record" },
];

export const HIPHOT_HUBSPOT_DEAL_ORIGINS = [
  { id: "ecommerce", label: "Ecommerce" },
  { id: "offertes", label: "Offertes" },
  { id: "mixed", label: "Ecommerce + Offertes" },
];

export function marketingStatusLabel(status) {
  return HIPHOT_MARKETING_STATUSES.find((s) => s.id === status)?.label || status || "Onbekend";
}

export function marketingSegmentLabels(segmentIds = []) {
  const labels = new Map(HIPHOT_MARKETING_SEGMENTS.map((s) => [s.id, s.label]));
  return (segmentIds || []).map((id) => labels.get(id) || id);
}

export function relationTypeLabel(type) {
  return HIPHOT_RELATION_TYPES.find((item) => item.id === type)?.label || type || "Onbekend";
}

export function hubspotDealOriginLabel(origin) {
  return HIPHOT_HUBSPOT_DEAL_ORIGINS.find((item) => item.id === origin)?.label || origin || "Onbekend";
}

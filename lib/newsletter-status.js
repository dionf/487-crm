// Statussen van nieuwsbriefcampagnes: labels, kleuren, filtergroepen en de
// regels voor bewerken en verzenden. Zonder serverimports, dus ook bruikbaar
// in de browser.

export const STATUS_LABELS = {
  draft: "Concept",
  tested: "Getest",
  approved: "Goedgekeurd",
  syncing: "Bezig met verzenden",
  scheduled: "Gepland",
  sent: "Verzonden",
  failed: "Mislukt",
  batch_waiting: "Batch wacht",
  paused: "Gepauzeerd",
};

// Filtergroepen in het overzicht. "Mislukt" valt onder concept: je kunt de
// campagne dan weer bewerken en opnieuw testen.
export const STATUS_GROUPS = [
  { id: "concept", label: "Concept", statuses: ["draft", "tested", "approved", "failed"] },
  { id: "ingepland", label: "Ingepland", statuses: ["scheduled"] },
  { id: "bezig", label: "Bezig met verzenden", statuses: ["syncing", "batch_waiting", "paused"] },
  { id: "verzonden", label: "Verzonden", statuses: ["sent"] },
];

export const EDITABLE_STATUSES = new Set(["draft", "tested", "failed"]);

export function statusGroup(status) {
  return STATUS_GROUPS.find((group) => group.statuses.includes(status))?.id || "concept";
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function statusClass(status) {
  if (status === "sent") return "bg-green-50 text-green-700 border-green-100";
  if (status === "tested") return "bg-blue-50 text-blue-700 border-blue-100";
  if (status === "syncing" || status === "scheduled" || status === "batch_waiting") return "bg-amber-50 text-brand-orange border-amber-100";
  if (status === "failed" || status === "paused") return "bg-red-50 text-red-600 border-red-100";
  return "bg-gray-50 text-gray-600 border-gray-100";
}

export function isFutureDateTime(value) {
  return Boolean(value) && new Date(value).getTime() > Date.now();
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function canMutateCampaign(campaign) {
  return EDITABLE_STATUSES.has(campaign?.status);
}

export function hasExpiredSchedule(campaign) {
  return Boolean(campaign.scheduled_at) && !isFutureDateTime(campaign.scheduled_at) && !["sent", "scheduled"].includes(campaign.status);
}

export function canSendCampaign(campaign) {
  return Boolean(campaign.test_sent_at) && !["sent", "scheduled", "syncing", "batch_waiting", "paused"].includes(campaign.status) && !hasExpiredSchedule(campaign);
}

export function sendActionLabel(campaign) {
  if (hasExpiredSchedule(campaign)) return "Tijd verlopen";
  if (campaign.batch_mode === "automatic") return "Start batches";
  return isFutureDateTime(campaign.scheduled_at) ? "Plannen" : "Verzenden";
}

export function sendActionTitle(campaign) {
  if (!campaign.test_sent_at) return "Eerst testmail sturen";
  if (hasExpiredSchedule(campaign)) return "Kies eerst een nieuwe toekomstige verzendtijd";
  if (campaign.batch_mode === "automatic") return "Automatische batchverzending starten";
  return isFutureDateTime(campaign.scheduled_at) ? "Definitief plannen" : "Definitief verzenden";
}

export function scheduledAtLabel(campaign) {
  if (campaign.status === "scheduled") return "Gepland";
  if (isFutureDateTime(campaign.scheduled_at)) return "Verzendtijd";
  return "Verzendtijd verstreken";
}

// De datum die in het overzicht bij een campagne hoort: verzonden, gepland
// of aangemaakt.
export function campaignDateLabel(campaign) {
  if (campaign.status === "sent") {
    return `Verzonden ${formatDateTime(campaign.sent_at || campaign.updated_at)}`;
  }
  if (campaign.scheduled_at && (campaign.status === "scheduled" || isFutureDateTime(campaign.scheduled_at))) {
    return `Gepland ${formatDateTime(campaign.scheduled_at)}`;
  }
  if (hasExpiredSchedule(campaign)) {
    return `Verzendtijd verstreken ${formatDateTime(campaign.scheduled_at)}`;
  }
  return `Aangemaakt ${formatDateTime(campaign.created_at)}`;
}

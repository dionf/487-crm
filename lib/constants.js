// 48-7 pipeline
export const LEAD_STATUSES_487 = [
  { id: "nieuw", label: "Nieuwe Leads", color: "gray" },
  { id: "gekwalificeerd", label: "Gekwalificeerd", color: "blue" },
  { id: "inventarisatie", label: "Inventarisatie", color: "purple" },
  { id: "offerte_verstuurd", label: "Offerte Verstuurd", color: "amber" },
  { id: "onderhandeling", label: "Onderhandeling", color: "orange" },
  { id: "gewonnen", label: "Gewonnen", color: "green" },
  { id: "verloren", label: "Verloren", color: "red" },
];

// HipHot pipeline
export const LEAD_STATUSES_HIPHOT = [
  { id: "nieuwe_aanvraag", label: "Nieuwe Aanvraag", color: "gray" },
  { id: "offerte_gestuurd", label: "Offerte Gestuurd", color: "blue" },
  { id: "reminder_gestuurd", label: "Reminder Gestuurd", color: "purple" },
  { id: "offerte_in_de_wacht", label: "In de Wacht", color: "amber" },
  { id: "in_overweging", label: "In Overweging", color: "orange" },
  { id: "offerte_gewonnen", label: "Gewonnen", color: "green" },
  { id: "offerte_verloren", label: "Verloren", color: "red" },
];

// Default (backwards compatible)
export const LEAD_STATUSES = LEAD_STATUSES_487;

// Get statuses for a tenant
export function getLeadStatuses(tenant) {
  if (tenant === "hiphot") return LEAD_STATUSES_HIPHOT;
  return LEAD_STATUSES_487;
}

export const SERVICE_TYPES = [
  { id: "discovery", label: "Discovery / Intake" },
  { id: "cowork_setup", label: "Cowork Setup" },
  { id: "training", label: "Training / Workshop" },
  { id: "maatwerk", label: "Maatwerk Project" },
  { id: "support_contract", label: "Support Contract" },
  { id: "partner", label: "Partner Deal" },
];

export const WIN_REASONS = [
  { id: "prijs", label: "Prijs" },
  { id: "expertise", label: "Expertise" },
  { id: "snelheid", label: "Snelheid" },
  { id: "referentie", label: "Referentie" },
  { id: "demo_overtuigend", label: "Demo overtuigend" },
  { id: "relatie", label: "Relatie" },
  { id: "anders", label: "Anders" },
];

export const LOST_REASONS = [
  { id: "prijs", label: "Prijs" },
  { id: "timing", label: "Timing" },
  { id: "concurrent", label: "Concurrent" },
  { id: "geen_budget", label: "Geen budget" },
  { id: "andere_prioriteiten", label: "Andere prioriteiten" },
  { id: "geen_fit", label: "Geen fit" },
  { id: "anders", label: "Anders" },
];

export const NOTE_TYPES = [
  { id: "gesprek", label: "Gesprek" },
  { id: "email", label: "Email" },
  { id: "intern", label: "Intern" },
  { id: "inventarisatie", label: "Inventarisatie" },
  { id: "todo", label: "To-do" },
];

export const QUOTE_STATUSES = [
  { id: "concept", label: "Concept" },
  { id: "verstuurd", label: "Verstuurd" },
  { id: "geaccepteerd", label: "Geaccepteerd" },
  { id: "afgewezen", label: "Afgewezen" },
  { id: "verlopen", label: "Verlopen" },
];

export const SOURCES = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "website", label: "Website" },
  { id: "referral", label: "Referral" },
  { id: "partner", label: "Partner" },
  { id: "event", label: "Event" },
  { id: "overig", label: "Overig" },
];

export const TEAM_MEMBERS = ["Dion", "Jaap", "Serge"];

export const STATUS_COLORS = {
  // 48-7
  nieuw: { bg: "bg-gray-100", text: "text-gray-700", dot: "bg-gray-400" },
  gekwalificeerd: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-400" },
  inventarisatie: { bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-400" },
  offerte_verstuurd: { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-400" },
  onderhandeling: { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-400" },
  gewonnen: { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-400" },
  verloren: { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-400" },
  // HipHot
  nieuwe_aanvraag: { bg: "bg-gray-100", text: "text-gray-700", dot: "bg-gray-400" },
  offerte_gestuurd: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-400" },
  reminder_gestuurd: { bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-400" },
  offerte_in_de_wacht: { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-400" },
  in_overweging: { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-400" },
  offerte_gewonnen: { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-400" },
  offerte_verloren: { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-400" },
};

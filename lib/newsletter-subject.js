// Vaste onderwerpregel van de gepersonaliseerde nieuwsbrief. Weeknummer en
// bedrijfsnaam vult de code in; AI schrijft het onderwerp niet.
export const PERSONALIZED_SUBJECT_TEMPLATE = "48-7 AI nieuws van week [week] voor [bedrijf]";

const TIME_ZONE = "Europe/Amsterdam";

// ISO-weeknummer (week 1 bevat de eerste donderdag), in Nederlandse tijd.
export function isoWeek(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)])
  );
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
}

// Weeknummer van de verzenddatum (gepland of verzonden), anders van vandaag.
export function campaignWeek(campaign, now = new Date()) {
  const date = campaign?.scheduled_at || campaign?.sent_at;
  const parsed = date ? new Date(date) : null;
  return isoWeek(parsed && !Number.isNaN(parsed.getTime()) ? parsed : now);
}

export function personalizedSubject(campaign, companyName, now = new Date()) {
  return PERSONALIZED_SUBJECT_TEMPLATE
    .replace("[week]", String(campaignWeek(campaign, now)))
    .replace("[bedrijf]", companyName || "jullie");
}

// Onderwerp voor overzichten zonder bedrijf (geschiedenis, campagnekop). Met
// `at` telt precies dat moment (bv. de testmail), niet de verzenddatum.
export function campaignSubjectLabel(campaign, at = null) {
  if (campaign?.mode !== "personalized") return campaign?.subject || "";
  const moment = at ? new Date(at) : null;
  if (moment && !Number.isNaN(moment.getTime())) {
    return PERSONALIZED_SUBJECT_TEMPLATE.replace("[week]", String(isoWeek(moment)));
  }
  return personalizedSubject(campaign, "[bedrijf]");
}

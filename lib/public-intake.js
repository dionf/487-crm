import { supabaseAdmin } from "@/lib/supabase-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Splitst een e-mailveld dat meerdere adressen kan bevatten.
 *
 * De chatbot geeft door wat de klant zegt, en klanten geven regelmatig twee
 * adressen op ("info@zaak.nl, jan@outlook.com — graag naar beide"). Een enkele
 * regex-check op de hele string wees zo'n aanvraag af met 400, waardoor er
 * niets in het CRM landde en de widget terugviel op de e-mailfallback.
 *
 * Het eerste geldige adres wordt het lead-adres; de rest bewaren we los zodat
 * een extra adres nooit meer de hele intake kost. De extra adressen zijn
 * bewust alleen informatief (samenvatting, notitie, teamnotificatie) — het
 * gebeurt te weinig om er leadkoppeling op te bouwen.
 */
export function parseEmailList(raw) {
  const seen = new Set();
  const emails = [];

  for (const part of String(raw || "").split(/[,;/|]+|\s+/)) {
    const cleaned = part
      .trim()
      .replace(/^[<("']+/, "")
      .replace(/[>)"'.,;:]+$/, "")
      .toLowerCase();
    if (!cleaned || seen.has(cleaned) || !EMAIL_RE.test(cleaned)) continue;
    seen.add(cleaned);
    emails.push(cleaned);
  }

  return { primary: emails[0] || null, extra: emails.slice(1) };
}

/**
 * Legt een geweigerde publieke intake vast in lead_inbox_log.
 *
 * Zonder dit verdween elke 400/403/429 spoorloos: de bezoeker kreeg een
 * bevestiging via de fallback-mail, maar in het CRM was niet te zien dat er
 * iets was binnengekomen. Alleen zichtbaar via SQL — bedoeld om stille
 * uitval te kunnen vinden, niet als tweede inbox.
 */
export async function logRejectedIntake({ tenant, kind, reason, email, name, sourceUrl }) {
  const safeTenant =
    typeof tenant === "string" && tenant.trim() ? tenant.trim().slice(0, 50) : "onbekend";

  try {
    await supabaseAdmin.from("lead_inbox_log").insert({
      tenant: safeTenant,
      status: "error",
      error_message: [reason, sourceUrl ? `bron: ${sourceUrl}` : null]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 1000),
      email_from: (email || "").slice(0, 300) || null,
      email_subject: `${kind} geweigerd — ${(name || "onbekend").slice(0, 150)}`,
    });
  } catch (err) {
    // Loggen mag de request nooit laten struikelen.
    console.error("Kon geweigerde intake niet loggen:", err);
  }
}

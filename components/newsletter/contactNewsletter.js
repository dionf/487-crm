import { apiFetch } from "@/lib/api";

export const NEWSLETTER_STATE_LABELS = {
  receives: { label: "Ontvangt nieuwsbrief", short: "Ontvangt", className: "bg-green-50 text-green-700 border-green-100" },
  company_off: { label: "Bedrijf niet ingeschreven", short: "Bedrijf uit", className: "bg-gray-50 text-gray-500 border-gray-100" },
  unsubscribed: { label: "Uitgeschreven", short: "Uitgeschreven", className: "bg-red-50 text-red-600 border-red-100" },
  bounced: { label: "Geblokkeerd (bounce/klacht)", short: "Bounce", className: "bg-red-50 text-red-600 border-red-100" },
  no_email: { label: "Geen e-mailadres", short: "Geen e-mail", className: "bg-gray-50 text-gray-400 border-gray-100" },
};

// Zet een e-mailadres aan of uit voor de nieuwsbrief. Bij een eerdere bounce
// of klacht vraagt de server om bevestiging; die vragen we hier.
// Geeft false terug als de gebruiker annuleert.
export async function setEmailNewsletter(email, subscribed) {
  const send = (force) =>
    apiFetch("/api/newsletter/subscription", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, subscribed, force }),
    });
  let res = await send(false);
  let json = await res.json().catch(() => ({}));
  if (res.status === 409 && json.needs_force) {
    if (!confirm(json.error)) return false;
    res = await send(true);
    json = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(json.error || "Nieuwsbriefstatus wijzigen mislukt");
  return true;
}

// Bedrijf in- of uitschrijven (company-niveau, zelfde regels als het leadformulier).
export async function setCompanyNewsletter(leadId, subscribed) {
  const res = await apiFetch(`/api/leads/${leadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      subscribed
        ? {
            marketing_consent: true,
            marketing_subscription_status: "subscribed",
            marketing_consent_source: "handmatig",
            marketing_consent_date: new Date().toISOString(),
          }
        : { marketing_consent: false, marketing_subscription_status: "non_marketing" }
    ),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Nieuwsbrief bedrijf wijzigen mislukt");
  return json;
}

// Publieke basis-URL van de CRM voor links in mails en offertes.
// Trimt witruimte: een env-waarde met een afsluitend regeleinde brak eerder
// links zoals "https://…app\n/offerte/…".
export function appBaseUrl() {
  const raw = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  return (raw || "https://crm.48-7.nl").replace(/\/+$/, "");
}

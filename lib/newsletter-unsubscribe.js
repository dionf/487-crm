import crypto from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";

// Uitschrijflinks voor mails die per ontvanger worden verstuurd (geen Resend
// broadcast, dus geen {{{RESEND_UNSUBSCRIBE_URL}}}). De link bevat alleen het
// ontvanger-ID plus een HMAC, geen e-mailadres.

function signingKey() {
  const raw = process.env.NEWSLETTER_SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new Error("NEWSLETTER_SETTINGS_ENCRYPTION_KEY ontbreekt");
  // Afgeleide sleutel, zodat de versleutelsleutel niet direct als HMAC-sleutel dient.
  return crypto.createHmac("sha256", raw.trim()).update("newsletter-unsubscribe-v1").digest();
}

export function unsubscribeSignature(recipientId) {
  return crypto.createHmac("sha256", signingKey()).update(String(recipientId)).digest("base64url");
}

export function verifyUnsubscribeSignature(recipientId, signature) {
  if (!recipientId || !signature) return false;
  const expected = Buffer.from(unsubscribeSignature(recipientId));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function buildUnsubscribeUrl(recipientId) {
  const params = new URLSearchParams({ r: recipientId, s: unsubscribeSignature(recipientId) });
  return `${appBaseUrl()}/api/public/newsletter/unsubscribe?${params}`;
}

// Voor testmails: opent de pagina, maar schrijft niemand uit.
export function previewUnsubscribeUrl() {
  return `${appBaseUrl()}/api/public/newsletter/unsubscribe?preview=1`;
}

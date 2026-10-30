import crypto from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";

// Deelbare webversie van een gepersonaliseerde nieuwsbrief: één link per
// campagne en bedrijf, ondertekend met een HMAC. Wie de link heeft, ziet de
// versie voor dat bedrijf (zonder naam van een ontvanger); meer niet.

function signingKey() {
  const raw = process.env.NEWSLETTER_SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new Error("NEWSLETTER_SETTINGS_ENCRYPTION_KEY ontbreekt");
  return crypto.createHmac("sha256", raw.trim()).update("newsletter-preview-v1").digest();
}

function signature(campaignId, leadId) {
  return crypto.createHmac("sha256", signingKey()).update(`${campaignId}:${leadId}`).digest("base64url");
}

export function verifyPreviewSignature(campaignId, leadId, given) {
  if (!campaignId || !leadId || !given) return false;
  const expected = Buffer.from(signature(campaignId, leadId));
  const actual = Buffer.from(String(given));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function buildPreviewUrl(campaignId, leadId) {
  const params = new URLSearchParams({ c: campaignId, l: leadId, s: signature(campaignId, leadId) });
  return `${appBaseUrl()}/api/public/newsletter/preview?${params}`;
}

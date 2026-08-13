import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const raw = process.env.NEWSLETTER_SETTINGS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("NEWSLETTER_SETTINGS_ENCRYPTION_KEY ontbreekt");
  }

  const normalized = raw.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const base64 = Buffer.from(normalized, "base64");
  if (base64.length === 32) return base64;

  const utf8 = Buffer.from(normalized, "utf8");
  if (utf8.length === 32) return utf8;

  throw new Error("NEWSLETTER_SETTINGS_ENCRYPTION_KEY moet 32 bytes zijn");
}

export function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
}

export function decryptSecret(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Ongeldige versleutelde waarde");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function secretLast4(value) {
  if (!value) return null;
  return String(value).slice(-4);
}

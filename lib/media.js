import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import sharp from "sharp";
import { findLogoCandidates } from "@/lib/logo-finder";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Publieke afbeeldingen (nieuwsbrief, bedrijfslogo's) in de bucket "media".
// Mailclients halen ze zonder login op, dus alleen beeld en geen documenten.

const BUCKET = "media";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

const SIGNATURES = [
  { type: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", ext: "gif", test: (b) => b.subarray(0, 4).toString("ascii") === "GIF8" },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

// Type op basis van de bytes, niet van de bestandsnaam of de opgegeven MIME-type.
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find((signature) => signature.test(buffer)) || null;
}

export async function uploadPublicImage({ tenant, folder, buffer }) {
  if (!buffer?.length) throw new Error("Leeg bestand");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Afbeelding is groter dan 2 MB");
  const kind = detectImageType(buffer);
  if (!kind) throw new Error("Alleen PNG, JPG, WebP of GIF");

  const safeFolder = String(folder || "misc").replace(/[^a-z0-9/_-]/gi, "");
  const path = `${tenant}/${safeFolder}/${crypto.randomUUID()}.${kind.ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: kind.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Uploaden mislukt: ${error.message}`);
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function readUploadedFile(formData, field = "file") {
  const file = formData.get(field);
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Geen bestand ontvangen");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Afbeelding is groter dan 2 MB");
  return Buffer.from(await file.arrayBuffer());
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:");
}

// Alleen publieke http(s)-adressen; geen interne netwerken (SSRF).
async function assertPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Ongeldige URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Alleen http(s)-adressen");
  const records = await dns.lookup(parsed.hostname, { all: true }).catch(() => []);
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("Adres niet bereikbaar");
  }
  return parsed;
}

const MAX_REDIRECTS = 4;
const MAX_DOWNLOAD_BYTES = MAX_IMAGE_BYTES * 2;

// Leest de body met een harde bovengrens: stopt zodra die wordt overschreden,
// in plaats van eerst alles binnen te halen.
async function readBodyLimited(res, limit) {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > limit) {
    await res.body?.cancel();
    throw new Error("Bestand te groot");
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Bestand te groot");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

// Volgt redirects zelf, zodat elk doel vóór het verzoek wordt gecontroleerd
// (geen omweg via een redirect naar een intern adres).
export async function fetchLimited(url, { accept } = {}) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; 48-7-CRM/1.0)", ...(accept ? { Accept: accept } : {}) },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error(`HTTP ${res.status}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status}`);
    }
    const buffer = await readBodyLimited(res, MAX_DOWNLOAD_BYTES);
    return { buffer, finalUrl: current };
  }
  throw new Error("Te veel doorverwijzingen");
}

// Haalt een afbeelding van een externe URL op en zet hem in de eigen bucket,
// zodat de mail niet afhangt van andermans server.
export async function importImageFromUrl({ tenant, folder, url }) {
  const { buffer } = await fetchLimited(url, { accept: "image/*" });
  return uploadPublicImage({ tenant, folder, buffer });
}

const LOGO_MAX_WIDTH = 600;
const LOGO_MAX_HEIGHT = 300;

function looksLikeSvg(buffer) {
  const head = buffer.subarray(0, 512).toString("utf8").trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

// Zet een logo om naar PNG (max 600×300, transparantie blijft) en weigert wat
// duidelijk geen logo is. SVG wordt omgezet, want mailclients tonen dat slecht.
export async function prepareLogo(buffer, { rejectWhite = false } = {}) {
  const svg = looksLikeSvg(buffer);
  if (!svg && !detectImageType(buffer)) throw new Error("Geen afbeelding (PNG, JPG, WebP, GIF of SVG)");
  const input = () => sharp(buffer, { density: svg ? 300 : 72, limitInputPixels: 40_000_000 });
  const meta = await input().metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < 32 || height < 16) throw new Error(`Afbeelding te klein (${width}×${height})`);
  if (width / height > 12 || height / width > 4) throw new Error(`Vreemde verhouding (${width}×${height})`);
  if (!svg && meta.format === "jpeg" && width >= 900 && height >= 450 && width / height < 2.2) {
    throw new Error("Lijkt een foto, geen logo");
  }

  const png = await input()
    .resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT, fit: "inside", withoutEnlargement: !svg })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let luminance = 0;
  let weight = 0;
  let clear = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.1) {
      clear += 1;
      continue;
    }
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luminance += alpha * value;
    weight += alpha;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!weight) throw new Error("Afbeelding is leeg");
  if (!clear && max - min < 3) throw new Error("Afbeelding is een effen vlak");
  // Wit logo op een transparante achtergrond is onzichtbaar op wit. Bij zoeken op
  // de website proberen we dan de volgende kandidaat; een eigen upload laten we toe.
  if (rejectWhite && clear > data.length / 40 && luminance / weight > 225) {
    throw new Error("Wit logo: onzichtbaar op een witte achtergrond");
  }
  return { buffer: png, width: info.width, height: info.height };
}

// Logo klaarmaken en in de bucket zetten. Geeft { url, width, height }.
export async function uploadLogo({ tenant, buffer, rejectWhite = false }) {
  const logo = await prepareLogo(buffer, { rejectWhite });
  const url = await uploadPublicImage({ tenant, folder: "logos", buffer: logo.buffer });
  return { url, width: logo.width, height: logo.height };
}

export async function importLogoFromUrl({ tenant, url }) {
  const { buffer } = await fetchLimited(url, { accept: "image/*" });
  return uploadLogo({ tenant, buffer });
}

// Haalt het logo van de website van een bedrijf: eerst het logo in de header,
// dan schema.org, og:image (alleen als het een logo is) en als laatste het
// app-icoon of favicon. Altijd van de homepage, ook als er een diepe link staat.
export async function importLogoFromWebsite({ tenant, websiteUrl }) {
  const raw = String(websiteUrl || "").trim();
  const site = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  const pages = [site];
  if (!site.includes("://www.")) pages.push(site.replace("://", "://www."));

  let candidates = [];
  for (const page of pages) {
    try {
      const { buffer, finalUrl } = await fetchLimited(page, { accept: "text/html,application/xhtml+xml" });
      candidates = findLogoCandidates(buffer.toString("utf8"), finalUrl);
      break;
    } catch {
      // Volgende variant.
    }
  }
  candidates.push({ kind: "url", value: `${site}/apple-touch-icon.png`, source: "apple-touch-icon" });

  // Ruim binnen de 30 seconden van de API-route blijven.
  const deadline = Date.now() + 18000;
  let lastError = null;
  for (const candidate of candidates.slice(0, 10)) {
    if (Date.now() > deadline) break;
    try {
      let buffer;
      if (candidate.kind === "svg") {
        buffer = Buffer.from(candidate.value);
      } else if (candidate.value.startsWith("data:")) {
        const data = candidate.value.match(/^data:image\/(?:svg\+xml|png|jpeg|webp|gif)(;base64)?,(.*)$/i);
        if (!data) continue;
        buffer = data[1] ? Buffer.from(data[2], "base64") : Buffer.from(decodeURIComponent(data[2]));
      } else {
        ({ buffer } = await fetchLimited(candidate.value, { accept: "image/*" }));
      }
      return { ...(await uploadLogo({ tenant, buffer, rejectWhite: true })), source: candidate.source };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError?.message?.startsWith("Wit logo") ? " (alleen een wit logo)" : "";
  throw new Error(`Geen bruikbaar logo gevonden op de website${detail}; upload het logo zelf`);
}

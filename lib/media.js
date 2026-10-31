import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
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

function attribute(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}

// Kandidaat-logo's uit de HTML van een website, beste eerst.
function logoCandidates(html, baseUrl) {
  const candidates = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attribute(tag, "rel").toLowerCase();
    const href = attribute(tag, "href");
    if (!href || !rel.includes("icon")) continue;
    const size = Number.parseInt((attribute(tag, "sizes").split("x")[0] || "0"), 10) || 0;
    const score = (rel.includes("apple-touch-icon") ? 1000 : 0) + size;
    candidates.push({ href, score });
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => {
      try {
        return new URL(candidate.href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((href) => href && !/\.(svg|ico)(\?|$)/i.test(href));
}

// Probeert een logo van de website te halen: apple-touch-icon of een groot
// icoon uit de HTML, anders het favicon via Google (altijd PNG).
export async function importLogoFromWebsite({ tenant, websiteUrl }) {
  const site = /^https?:\/\//i.test(websiteUrl || "") ? websiteUrl : `https://${websiteUrl}`;
  const parsed = await assertPublicUrl(site);
  const tries = [];
  try {
    const { buffer, finalUrl } = await fetchLimited(parsed.toString(), { accept: "text/html" });
    tries.push(...logoCandidates(buffer.toString("utf8"), finalUrl));
  } catch {
    // Website niet leesbaar: val terug op de vaste paden hieronder.
  }
  tries.push(new URL("/apple-touch-icon.png", parsed).toString());
  tries.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=256`);

  for (const url of [...new Set(tries)]) {
    try {
      const { buffer } = await fetchLimited(url, { accept: "image/*" });
      if (!detectImageType(buffer)) continue;
      return await uploadPublicImage({ tenant, folder: "logos", buffer });
    } catch {
      // Volgende kandidaat.
    }
  }
  throw new Error("Geen bruikbaar logo gevonden op de website; upload het logo zelf");
}

import { fetchLimited } from "@/lib/media";

// Leesbare tekst van een gelinkt artikel, als achtergrond voor de
// personalisatie. Kort gehouden: genoeg om uit te leggen wat iets is.
const MAX_CHARS = 6000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function htmlToText(html) {
  const body =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    html;
  const text = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|br|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CHARS);
}

// Geeft null terug als de pagina niet leesbaar is; de personalisatie gaat dan
// verder met alleen de itemtekst.
export async function fetchArticleText(url) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.text;
  let text = null;
  try {
    const { buffer } = await fetchLimited(url, { accept: "text/html" });
    text = htmlToText(buffer.toString("utf8")) || null;
  } catch {
    text = null;
  }
  cache.set(url, { text, expires: Date.now() + CACHE_TTL_MS });
  return text;
}

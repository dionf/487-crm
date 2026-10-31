import { fetchLimited } from "@/lib/media";

// Leesbare tekst van een gelinkt artikel, als achtergrond voor de
// personalisatie. Kort gehouden: genoeg om uit te leggen wat iets is.
const MAX_CHARS = 6000;

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

// Het langste <article>- of <main>-blok, zodat een lijst met gerelateerde
// berichten boven het artikel niet als hoofdtekst wordt gekozen.
function mainBlock(html) {
  const blocks = [...html.matchAll(/<(article|main)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.sort((a, b) => b.length - a.length)[0] || html;
}

export function htmlToText(html, maxChars = MAX_CHARS) {
  const body = mainBlock(html);
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
    .replace(/"{3,}/g, '"')
    .slice(0, maxChars);
}

// Geeft null terug als de pagina niet leesbaar is; de personalisatie gaat dan
// verder met alleen de itemtekst. De tekst wordt bewaard bij het item
// (article_text), dus hier is geen eigen cache nodig.
export async function fetchArticleText(url) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  try {
    const { buffer } = await fetchLimited(url, { accept: "text/html" });
    return htmlToText(buffer.toString("utf8")) || null;
  } catch {
    return null;
  }
}

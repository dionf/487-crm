// Zoekt in de HTML van een bedrijfswebsite naar het logo. Geeft kandidaten
// terug, beste eerst:
// 1. logo in de header: <img> of inline <svg> met "logo"/"brand" in class,
//    id, alt of src, of een afbeelding met de bedrijfsnaam in de homepage-link
// 2. schema.org "logo"
// 3. og:image, alleen als de URL "logo" bevat
// 4. apple-touch-icon en de grotere favicons
// Alleen tekstbewerking; ophalen en controleren gebeurt in lib/media.js.

// Afbeeldingen die wel "logo" heten maar niet van het bedrijf zelf zijn.
const NOT_OWN_LOGO =
  /(partner|client|klant|award|certif|keurmerk|footer|payment|betaal|sponsor|iso-|thuiswinkel|trustpilot|google|facebook|linkedin|instagram|twitter|youtube|flag|vlag|wpml|language|lang-|\/flags?\/|recron|anvr|sgr|badge|seal|waarborg|member|lidmaatschap|erkend)/i;

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : "";
}

const decodeEntities = (value) => value.replace(/&amp;|&#0?38;/g, "&").replace(/&quot;/g, '"').trim();

function largestFromSrcset(srcset) {
  const parts = srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/))
    .filter((part) => part[0]);
  parts.sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1));
  return parts[0]?.[0] || "";
}

// Ook lazy-loading: het echte adres staat dan vaak in data-src.
function imageSource(tag) {
  for (const name of ["data-src", "data-lazy-src", "data-original", "src"]) {
    const value = attribute(tag, name);
    if (value && !value.startsWith("data:image/gif")) return value;
  }
  const srcset = attribute(tag, "data-srcset") || attribute(tag, "srcset");
  return srcset ? largestFromSrcset(srcset) : "";
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findLogoCandidates(html, baseUrl) {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./, "");
  const nameWord = host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const out = [];
  const add = (candidate) => out.push(candidate);
  const resolve = (href) => {
    try {
      return new URL(decodeEntities(href), base).toString();
    } catch {
      return null;
    }
  };

  const headerEnd = (() => {
    const index = html.search(/<\/header>/i);
    return index > 0 ? index : Math.min(html.length, 60000);
  })();
  const bodyStart = Math.max(0, html.search(/<body/i));
  const homeLink = new RegExp(
    `<a\\b[^>]*href\\s*=\\s*["'](\\/|\\.\\/|https?:\\/\\/(www\\.)?${escapeRegExp(host)}\\/?)["'][^>]*>\\s*(<(div|span|picture|source)[^>]*>\\s*){0,3}$`,
    "i",
  );
  const logoContext = /(class|id)\s*=\s*["'][^"']*(logo|brand)[^"']*["'][^<]*(<[^>]*>[^<]*){0,3}$/i;

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = imageSource(tag);
    if (!src) continue;
    const before = html.slice(Math.max(0, match.index - 400), match.index);
    const inHeader = match.index < headerEnd;
    const ownClass = /logo/i.test(`${attribute(tag, "class")} ${attribute(tag, "id")}`);
    const inSrc = /logo/i.test(src);
    const inAlt = /logo/i.test(attribute(tag, "alt"));
    const inContext = logoContext.test(before);
    const logoSignal = ownClass || inSrc || inAlt || inContext;
    const named = Boolean(nameWord) && `${src}${attribute(tag, "alt")}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(nameWord);
    if (NOT_OWN_LOGO.test(`${src} ${attribute(tag, "class")} ${attribute(tag, "alt")}`)) continue;
    // Buiten de header alleen met de bedrijfsnaam erin (geen klant- of partnerlogo's).
    if (!inHeader && !named) continue;
    // Alleen een link naar de homepage is te zwak (foto's, vlaggetjes): dan moet de naam erin staan.
    const viaHomeLink = inHeader && homeLink.test(before);
    if (!logoSignal && !(viaHomeLink && named)) continue;

    let score = logoSignal ? 100 : 60;
    if (ownClass) score += 30;
    if (inSrc) score += 25;
    if (inContext) score += 20;
    if (viaHomeLink && logoSignal) score += 15;
    if (inAlt) score += 10;
    if (inHeader) score += 40;
    if (named) score += 20;
    score -= Math.min(60, Math.floor((match.index - bodyStart) / 5000));
    const url = resolve(src);
    if (url) add({ kind: "url", value: url, score, source: "header", named, headerImage: true });
  }

  for (const match of html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    if (match.index > headerEnd + 20000) break;
    const svg = match[0];
    const open = svg.match(/^<svg\b[^>]*>/i)[0];
    const before = html.slice(Math.max(0, match.index - 300), match.index);
    const own =
      /logo/i.test(attribute(open, "class") + attribute(open, "id") + attribute(open, "aria-label")) ||
      /<title[^>]*>[^<]*logo/i.test(svg);
    if (!own && !logoContext.test(before) && !homeLink.test(before)) continue;
    // Kleine icoontjes en verwijzingen naar een sprite overslaan.
    if (svg.length < 300 || (/<use\b/i.test(svg) && svg.length < 600)) continue;
    const full = /xmlns=/.test(open) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    add({ kind: "svg", value: full, score: 150 + (match.index < headerEnd ? 40 : 0), source: "header (svg)" });
  }

  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
    const logo = block.match(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/i);
    const url = logo && resolve(logo[1].replace(/\\\//g, "/"));
    if (url) add({ kind: "url", value: url, score: 90, source: "schema.org" });
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const property = (attribute(tag, "property") || attribute(tag, "name")).toLowerCase();
    const content = attribute(tag, "content");
    if (!content || !["og:image", "og:logo"].includes(property)) continue;
    if (property === "og:image" && !/logo/i.test(content)) continue;
    const url = resolve(content);
    if (url) add({ kind: "url", value: url, score: 80, source: "og:image" });
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attribute(tag, "rel").toLowerCase();
    const href = attribute(tag, "href");
    if (!href || !rel.includes("icon") || rel.includes("mask")) continue;
    const size = Number.parseInt(attribute(tag, "sizes").split("x")[0] || "0", 10) || 0;
    const url = resolve(href);
    const apple = rel.includes("apple");
    if (url) add({ kind: "url", value: url, score: 10 + (apple ? 20 : 0) + Math.min(size, 512) / 50, source: apple ? "apple-touch-icon" : "favicon" });
  }

  // Staat er een logo met de bedrijfsnaam op de pagina, laat dan andere
  // header-logo's (merken, dochterbedrijven, partners) weg.
  const hasNamed = out.some((candidate) => candidate.headerImage && candidate.named);
  const seen = new Set();
  return out
    .filter((candidate) => !hasNamed || !candidate.headerImage || candidate.named)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => (seen.has(candidate.value) ? false : seen.add(candidate.value)));
}

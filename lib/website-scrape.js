import { htmlToText } from "@/lib/article-text";
import { fetchLimited } from "@/lib/media";

const MAX_CHARS = 3000;

// Haalt de leesbare tekst van een website op (max ~3000 tekens), voor AI-analyses.
// Via fetchLimited, dus alleen publieke adressen, ook na doorverwijzingen.
// Geeft null terug als de site niet leesbaar is.
export async function scrapeWebsite(url) {
  // Zonder www lukt het soms niet; probeer dan de www-variant.
  const urls = [url];
  if (!url.includes("www.")) {
    urls.push(url.replace(/^(https?:\/\/)/i, "$1www."));
  }

  for (const tryUrl of urls) {
    try {
      const { buffer } = await fetchLimited(tryUrl, { accept: "text/html,application/xhtml+xml" });
      const html = buffer.toString("utf8");
      if (html.length < 100) continue;

      // Eén teken extra, zodat te zien is of er is afgekapt.
      const text = htmlToText(html, MAX_CHARS + 1);
      if (!text) continue;
      return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}...` : text;
    } catch {
      continue;
    }
  }
  return null;
}

import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_MODEL } from "@/lib/ai-models";
import { scrapeWebsite } from "@/lib/website-scrape";

// Secties uit leads.ai_summary die over het bedrijf zelf gaan. Alles daarna
// ("Kansen voor 48-7", "Gesprekstip") is interne verkoopinfo en gaat niet mee.
const PUBLIC_SUMMARY_SECTIONS = ["wat doet het bedrijf", "wat ze doen", "sector", "omvang"];

export function publicPartOfAiSummary(summary) {
  if (!summary) return "";
  const kept = [];
  let keep = false;
  for (const rawLine of String(summary).replace(/\*\*/g, "").split("\n")) {
    const line = rawLine.trim();
    // Kop als "## Sector" of label als "Sector: tekst" (geen opsommingsteken).
    const heading = line.match(/^#{1,4}\s*(.+)$/) || line.match(/^([A-Za-zÀ-ÿ][^:]{1,60}):\s*(.*)$/);
    if (heading) {
      const name = heading[1].trim().toLowerCase();
      keep = PUBLIC_SUMMARY_SECTIONS.some((section) => name.startsWith(section));
      if (keep) kept.push(heading[2] ? `${heading[1].trim()}: ${heading[2].trim()}` : `${heading[1].trim()}:`);
      continue;
    }
    if (keep && line) kept.push(line);
  }
  return kept.join("\n").trim();
}

function normalizeUrl(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

// Schrijft een neutraal profiel (3-5 zinnen) van het bedrijf, geschikt als
// context voor gepersonaliseerde nieuwsbriefteksten die de klant zelf leest.
export async function generateNewsletterProfile(lead) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("API key niet geconfigureerd");

  const websiteUrl = normalizeUrl(lead.website_url);
  const websiteContent = websiteUrl ? await scrapeWebsite(websiteUrl) : null;
  const summaryContext = publicPartOfAiSummary(lead.ai_summary);

  if (!websiteContent && !summaryContext && !lead.industry) {
    throw new Error("Te weinig informatie: geen website, analyse of branche bij dit bedrijf");
  }

  const prompt = `Schrijf een kort, neutraal profiel van het bedrijf hieronder. Het profiel wordt gebruikt om in een nieuwsbrief van 48-7 AI Professionals per item uit te leggen waarom het voor dit bedrijf interessant is. De ontvanger kan de daarop gebaseerde teksten lezen, dus schrijf alleen wat publiek verifieerbaar is.

Schrijf 3 tot 5 zinnen in het Nederlands, als doorlopende tekst zonder koppen of opsommingen:
- wat het bedrijf doet en voor wie (klanten, markt);
- sector en, als dat blijkt, schaal of regio;
- welke soorten werk of processen er waarschijnlijk zijn waar AI kan helpen (bijv. veel documenten, klantcontact, planning, data), zonder dat als verkoopkans te formuleren.

REGELS:
- Gebruik ALLEEN de bronnen hieronder. Verzin niets; laat weg wat je niet weet.
- Geen verkooptaal, geen kansen voor 48-7, geen interne notities, geen prijzen, geen namen van contactpersonen.
- Geef alleen het profiel terug, zonder inleiding.

Bedrijf: ${lead.company_name}
${lead.website_url ? `Website: ${lead.website_url}` : ""}
${lead.industry ? `Branche (CRM): ${lead.industry}` : ""}
${lead.city ? `Plaats: ${lead.city}` : ""}

${websiteContent ? `--- WEBSITE CONTENT ---\n${websiteContent}\n--- EINDE WEBSITE ---` : "Geen website content beschikbaar."}

${summaryContext ? `--- EERDERE BESCHRIJVING ---\n${summaryContext}\n--- EINDE BESCHRIJVING ---` : ""}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: NEWSLETTER_MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const profile = resp.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!profile) throw new Error("Claude gaf een leeg antwoord terug");
  return profile;
}

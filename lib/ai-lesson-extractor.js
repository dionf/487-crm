import Anthropic from "@anthropic-ai/sdk";

// Zelfde model als elders in de CRM — bewezen beschikbaar op deze API-key
const EXTRACTOR_MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `Je bent een reflectie-assistent voor HipHot offerte-advies.

Een AI heeft een offerte-voorstel gedaan; een HipHot-medewerker heeft het aangepast.
Analyseer het VERSCHIL en extraheer max 4 herbruikbare lessen voor toekomstige offertes
in vergelijkbare situaties.

REGELS:
- Alleen lessen die GENERALISEERBAAR zijn (niet "deze klant wil blauw logo")
- Concrete, actionable (niet "wees aardig")
- Max 200 tekens per lesson
- context_tags: 2-5 tags (lowercase, underscore_separated) uit de klantsituatie die de les relevant maken
- priority 1-10: hoe belangrijk voor toekomstige offertes (impact × frequentie waarschijnlijk)

Als er GEEN meaningful verschillen zijn → return { "lessons": [] }.

OUTPUT FORMAT (strikt, alleen deze JSON, geen tekst eromheen):
{ "lessons": [ { "lesson": "...", "context_tags": ["..."], "priority": N } ] }`;

/**
 * Check of het diff tussen initieel en finaal voorstel significant genoeg is
 * om lessen te extraheren. Voorkomt spam bij kleine prijs-tweaks.
 */
export function shouldExtractLessons(initialQuote, finalQuote) {
  if (!initialQuote || !finalQuote) return false;
  const initialItems = initialQuote.line_items || [];
  const finalItems = finalQuote.line_items || [];

  // 1. Aantal regels verschilt
  if (initialItems.length !== finalItems.length) return true;

  // 2. SKU-set verschilt
  const initialSkus = new Set(initialItems.map((i) => i.sku).filter(Boolean));
  const finalSkus = new Set(finalItems.map((i) => i.sku).filter(Boolean));
  if (initialSkus.size !== finalSkus.size) return true;
  for (const sku of initialSkus) {
    if (!finalSkus.has(sku)) return true;
  }

  // 3. Totaal verschilt >15%
  const sum = (items) =>
    items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  const initialTotal = sum(initialItems);
  const finalTotal = sum(finalItems);
  if (initialTotal === 0) return finalTotal > 0;
  const pct = Math.abs(finalTotal - initialTotal) / initialTotal;
  if (pct > 0.15) return true;

  // 4. Aantallen per-SKU verschillen
  const initialByQty = Object.fromEntries(initialItems.map((i) => [i.sku, Number(i.quantity || 0)]));
  for (const i of finalItems) {
    if (initialByQty[i.sku] !== Number(i.quantity || 0)) return true;
  }

  return false;
}

/**
 * Extraheer lessen uit het verschil initieel vs finaal.
 *
 * @param {object} opts
 * @param {object} opts.initialQuote - eerste AI-voorstel
 * @param {object} opts.finalQuote - uiteindelijke offerte bij commit
 * @param {Array} opts.chatLog - [{from, text}]
 * @param {object} opts.conversationData - chatbot situatie/advies
 * @returns {Promise<Array<{ lesson, context_tags, priority }>>}
 */
export async function extractLessons({ initialQuote, finalQuote, chatLog, conversationData }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { lessons: [], skipReason: "ANTHROPIC_API_KEY ontbreekt" };
  }

  if (!shouldExtractLessons(initialQuote, finalQuote)) {
    return {
      lessons: [],
      skipReason: "Te weinig verschil tussen initieel en finaal voorstel (geen SKU/qty/totaal-wijzigingen > 15%)",
    };
  }

  const anthropic = new Anthropic({ apiKey });
  const chatText = Array.isArray(chatLog)
    ? chatLog
        .map((m) => `${m.from === "ai" ? "AI" : "Medewerker"}: ${m.text}`)
        .join("\n")
    : "";

  const userMessage = `KLANTSITUATIE:
${JSON.stringify(conversationData || {}, null, 2)}

INITIEEL AI-VOORSTEL:
${JSON.stringify(initialQuote, null, 2)}

FINALE OFFERTE (na medewerker-correcties):
${JSON.stringify(finalQuote, null, 2)}

CHAT VERLOOP TUSSEN AI EN MEDEWERKER:
${chatText}

Extraheer de generaliseerbare lessen uit dit verschil.`;

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.error("[ai-lesson-extractor] Claude error:", err.message);
    return { lessons: [], skipReason: `Claude API fout: ${err.message}` };
  }

  const text = resp.content?.[0]?.text || "";
  let parsed = null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* ignore */
  }

  if (!parsed || !Array.isArray(parsed.lessons)) {
    return {
      lessons: [],
      skipReason: `Claude antwoordde niet met geldige JSON (eerste 200 chars: "${text.substring(0, 200)}")`,
    };
  }

  // Normaliseer
  const lessons = parsed.lessons
    .filter((l) => l && typeof l.lesson === "string" && l.lesson.trim().length > 0)
    .slice(0, 4)
    .map((l) => ({
      lesson: l.lesson.trim().substring(0, 500),
      context_tags: Array.isArray(l.context_tags)
        ? l.context_tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5)
        : [],
      priority: Math.max(1, Math.min(10, Number(l.priority) || 5)),
    }));

  return {
    lessons,
    skipReason: lessons.length === 0 ? "Claude vond geen generaliseerbare lessen in dit verschil" : null,
  };
}

/**
 * Bouw context-tags uit de chatbot-situatie. Wordt gebruikt voor retrieval
 * en om extractie-tags te verrijken als de AI ze vergeet.
 */
export function buildContextTags(conversationData) {
  const s = conversationData?.situatie || {};
  const tags = new Set();

  // Branche / sector
  if (s.branche) {
    const slug = String(s.branche).toLowerCase();
    // Keywords extracten — ook partial matches
    if (slug.includes("school") || slug.includes("kinderopvang")) tags.add("school");
    if (slug.includes("bouw")) tags.add("bouw");
    if (slug.includes("horeca") || slug.includes("terras")) tags.add("horeca");
    if (slug.includes("festival") || slug.includes("event")) tags.add("festival");
    if (slug.includes("sport") || slug.includes("zwem")) tags.add("sport");
    if (slug.includes("hotel") || slug.includes("camping")) tags.add("recreatie");
    if (slug.includes("tuin") || slug.includes("hovenier")) tags.add("hoveniers");
  }

  // Plaatsing
  const plaatsing = String(s.plaatsing || "").toLowerCase();
  if (plaatsing.includes("paal")) tags.add("paal");
  if (plaatsing.includes("muur")) tags.add("muurmontage");
  if (plaatsing.includes("balie") || plaatsing.includes("receptie")) tags.add("balie");
  if (plaatsing.includes("hek")) tags.add("hek");

  // Binnen / buiten
  const bb = String(s.binnen_buiten || "").toLowerCase();
  if (bb.includes("buiten")) tags.add("buiten");
  if (bb.includes("binnen")) tags.add("binnen");

  // Custom / eigen ontwerp
  const cd = String(s.custom_design || "").toLowerCase();
  if (cd && cd !== "nee" && cd !== "no" && cd !== "false") tags.add("eigen_logo");

  // Mobile / multi-locatie (uit opmerkingen)
  const opm = String(s.opmerkingen || "").toLowerCase();
  if (/\d+\s*(bus|auto|wagen|werkbus|voertuig)/.test(opm)) {
    tags.add("werkbussen");
    tags.add("mobiel");
    tags.add("multi_locatie");
  }
  if (/meerdere locaties|verschillende plaatsen|vestigingen/.test(opm)) {
    tags.add("multi_locatie");
  }

  // Aantal medewerkers → grootte-categorie
  const aantal = Number(s.aantal_medewerkers);
  if (Number.isFinite(aantal)) {
    if (aantal < 50) tags.add("klein");
    else if (aantal < 250) tags.add("middelgroot");
    else tags.add("groot");
  }

  return [...tags];
}

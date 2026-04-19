import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase";
import { buildContextTags } from "./ai-lesson-extractor";

const MODEL = "claude-sonnet-4-20250514";

// Haal de top N actieve lessen op die matchen op context-tags
export async function fetchRelevantLessons({ tenant, tags, limit = 10 }) {
  if (!tenant) return [];
  let query = supabase
    .from("ai_quote_lessons")
    .select("lesson, priority, context_tags")
    .eq("tenant", tenant)
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  // Als we tags hebben: overlap-match (PostgREST: 'ov' / overlaps)
  if (Array.isArray(tags) && tags.length > 0) {
    query = query.overlaps("context_tags", tags);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[fetchRelevantLessons]", error.message);
    return [];
  }
  return data || [];
}

// Haal de actieve SKU-catalogus uit hiphot_articles (gesynchroniseerd met WC)
export async function getProductCatalog() {
  const { data, error } = await supabase
    .from("hiphot_articles")
    .select("sku, name, description, verkoop_price, sale_price, inkoop_price, category, wc_product_id")
    .eq("is_active", true)
    .order("category", { ascending: true });
  if (error) throw new Error(`Kon catalogus niet laden: ${error.message}`);
  return data || [];
}

function formatCatalog(products) {
  return products
    .map((p) => {
      const price = p.sale_price && Number(p.sale_price) < Number(p.verkoop_price)
        ? `€${p.sale_price} (aanbieding, was €${p.verkoop_price})`
        : `€${p.verkoop_price}`;
      return `- SKU ${p.sku} | ${p.name} | ${price}${p.category ? ` | categorie: ${p.category}` : ""}`;
    })
    .join("\n");
}

function formatLessons(lessons) {
  if (!Array.isArray(lessons) || lessons.length === 0) return "";
  return lessons
    .map((l) => `- [prio ${l.priority}] ${l.lesson}`)
    .join("\n");
}

function buildSystemPrompt(products, lessons = []) {
  const catalog = formatCatalog(products);
  const lessonsBlock = formatLessons(lessons);
  return `Je bent de offerte-adviseur van HipHot B.V. — een bedrijf dat op maat gemaakte zonnebrand-dispensers met navullingen levert aan bedrijven, scholen, festivals, horeca en sportclubs. Je helpt een medewerker om na een chatbot-adviesgesprek snel een passende offerte samen te stellen.

# CALCULATIE-LOGICA

Inputs uit de chatbot: aantal personen, sector, binnen/buiten, plaatsing, custom_design, opmerkingen.

Basisformule per dag:
- num_users = num_people × usage_percent
- total_applications = num_users × reapply_times
- liters_needed = total_applications / apps_per_liter  (850 voor F30, 500 voor F50)
- Rond naar boven af op 0,5L stappen
- aantal_flessen_1L = Math.ceil(liters_needed)

Seizoen = dagberekening × zon-dagen.

## Sector-aannames

| Sector | Gebruik % | Insmeer-momenten | SPF | Zon-dagen |
|---|---|---|---|---|
| School/kinderopvang | 50% | 1x | F50 (altijd voor kinderen) | ~25 |
| Bouw/buitenwerkers | 90% | 2-3x | F30 of mix | 80-100 |
| Horeca/terras | 60% | 1-2x | F30 of mix | ~60 |
| Festival/event | 70% | 1x | F30 | 1-3 per event |
| Sportclub/zwembad | 80% | 2x | F50 | seizoensafhankelijk |
| Hotel/camping | 60% | 1-2x | mix F30/F50 | 60-90 |

## Aantal dispensers

Vuistregel: 1 per 75-100 actieve gebruikers tegelijk.
- Klein schoolplein/terras: 1-2
- Groot bouwterrein/meerdere locaties: 1 per werklocatie
- Festival 1000+: 3-5 verspreid
- Sporthal/zwembad: 1-2 bij kleedkamers/ingang

# HARDE REGELS

- **Altijd drip tray** als plaatsing = muurmontage en binnen_buiten = buiten (zonder overkapping).
- **Dispenser met eigen logo** kiezen als custom_design != "nee" (en != leeg); anders de standaard dispenser.
- **Kinderen → altijd F50.**
- **Gratis verzending** vanaf €199 excl. BTW → noem dit in rationale als totaal >= €199.
- **Belgische klant** (telefoon begint met 00324/ +324 / 04 zonder landcode, of expliciet genoemd) → noem in rationale dat EU BTW-behandeling/hiphot.eu overwogen moet worden.
- **Standaard 1 pakket** — GEEN A/B opties, tenzij de medewerker expliciet om alternatief vraagt.

# SKU-CATALOGUS

Kies UITSLUITEND SKU's uit deze lijst. Als je twijfelt welke SKU past, kies de meest voor de hand liggende match en meld het in je message:

${catalog}

${lessonsBlock ? `# GELEERDE REGELS VAN JE COLLEGA'S

De HipHot-medewerkers hebben eerder offertes handmatig gecorrigeerd. Deze lessen zijn daaruit geëxtraheerd en gelden voor vergelijkbare situaties. Volg ze tenzij er een sterke reden is om af te wijken (leg dat dan uit in de rationale).

${lessonsBlock}

` : ""}# OUTPUT FORMAT

Antwoord ALTIJD met exact één JSON-object, zonder extra tekst ervoor of erna:

{
  "message": "Korte uitleg van wat je hebt gedaan of een vraag aan de medewerker (1-3 zinnen, conversational)",
  "quote": {
    "line_items": [
      {
        "sku": "HH-XYZ",
        "name": "Productnaam uit catalogus",
        "quantity": 2,
        "unit_price": 59.95,
        "description": null
      }
    ],
    "discount_pct": 0,
    "shipping_cost": 0,
    "rationale": "2-4 zinnen: waarom dit pakket past bij deze klantsituatie (aantal, spf-keuze, dispensers, verzending, etc)"
  }
}

Belangrijk:
- Prijzen ALTIJD in euro's, decimalen met punt (59.95 niet 59,95).
- \`discount_pct\` is 0-100. Pas alleen korting toe als de medewerker erom vraagt, of noem de mogelijkheid in message.
- \`shipping_cost\` in euro's. 0 als totaal >= €199 (gratis verzending).
- Als de vraag onduidelijk is of iets ontbreekt, zet \`quote\` gelijk aan de VORIGE state en stel de vraag in \`message\`.
- Als je SKU's weglaat of toevoegt bij een refinement, pas de volledige line_items array aan (geen diff).`;
}

/**
 * Genereer of verfijn een offerte-voorstel.
 *
 * @param {object} opts
 * @param {string} opts.tenant - 'hiphot' (voor lesson-retrieval-scope)
 * @param {object} opts.conversationData - form_submissions.conversation_data (situatie+advies+openstaande_vragen)
 * @param {Array}  opts.history - Claude messages array, leeg bij eerste call
 * @param {string} opts.userMessage - de vraag/aanwijzing van de medewerker (null bij eerste call)
 * @returns {Promise<{ ai_message: string, quote_state: object, history: Array, raw?: string, error?: string, lessons_used?: Array }>}
 */
export async function generateOrRefine({ tenant, conversationData, history, userMessage }) {
  const products = await getProductCatalog();
  if (products.length === 0) {
    return {
      error: "SKU-catalogus is leeg — draai eerst /api/hiphot/products/sync",
    };
  }

  // Haal relevante lessen op basis van de klantsituatie
  const tags = buildContextTags(conversationData);
  const lessons = tenant ? await fetchRelevantLessons({ tenant, tags, limit: 10 }) : [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt(products, lessons);

  // Bouw Claude messages
  const messages = [];
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) {
    // Eerste call: initiële situatie als user-turn
    messages.push({
      role: "user",
      content: `Een klant heeft zojuist een adviesgesprek met de HipHot-chatbot voltooid. Hier is de gestructureerde data:

${JSON.stringify(conversationData, null, 2)}

Stel een passend offerte-voorstel samen volgens de regels.`,
    });
  } else {
    messages.push(...safeHistory);
    if (userMessage) {
      messages.push({ role: "user", content: userMessage });
    }
  }

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages,
    });
  } catch (err) {
    return { error: `AI fout: ${err.message}` };
  }

  const rawText = resp.content?.[0]?.text || "";

  // Extraheer JSON uit het antwoord
  let parsed = null;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* ignore parse error */
  }

  if (!parsed || !parsed.quote || !Array.isArray(parsed.quote.line_items)) {
    return {
      error: "AI response kon niet worden geparsed",
      raw: rawText.substring(0, 500),
    };
  }

  // Valideer dat elke line_item een SKU heeft die in de catalogus staat
  const validSkus = new Set(products.map((p) => p.sku));
  const unknownSkus = parsed.quote.line_items
    .map((i) => i.sku)
    .filter((s) => s && !validSkus.has(s));

  const newHistory = [...messages, { role: "assistant", content: rawText }];

  return {
    ai_message: parsed.message || "",
    quote_state: {
      line_items: parsed.quote.line_items,
      discount_pct: Number(parsed.quote.discount_pct) || 0,
      shipping_cost: Number(parsed.quote.shipping_cost) || 0,
      rationale: parsed.quote.rationale || "",
    },
    history: newHistory,
    warnings: unknownSkus.length ? [`Onbekende SKU's: ${unknownSkus.join(", ")}`] : [],
    lessons_used: lessons.length,
  };
}

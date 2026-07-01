import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase";
import { buildContextTags } from "./ai-lesson-extractor";

const MODEL = "claude-sonnet-4-6";

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
- liters_needed = total_applications / apps_per_liter  (850 keer insmeren per liter F30, 450 keer insmeren per liter F50)
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
- **Kinderen → altijd F50.** (Formuleer in de rationale als "SPF50 aangeraden voor kinderen", niet "verplicht".)
- **Gratis verzending** vanaf €199 excl. BTW → noem dit in de rationale als totaal >= €199 ("Inclusief gratis verzending.").
- **Belgische klant** (telefoon begint met 00324/ +324 / 04 zonder landcode, of expliciet genoemd) → noem dit NIET in de rationale (die is klant-zichtbaar), maar wel kort in \`message\` zodat de medewerker BTW/hiphot.eu kan checken.
- **Standaard 1 pakket** — GEEN A/B opties, tenzij de medewerker expliciet om alternatief vraagt.

# RATIONALE — KLANT-ZICHTBARE TOELICHTING

De \`rationale\` komt **1-op-1 in het opmerkingen-blok van de offerte** dat de klant ziet. Schrijf dus alsof je rechtstreeks tegen de klant praat: vriendelijk, helder, geen interne jargon.

**Wel doen:**
- Korte natuurlijke tekst van 2–4 zinnen.
- Benoem de situatie (aantal gebruikers, type omgeving) in spreektaal.
- Leg de SPF-keuze uit als advies, niet als regel.
- Vermeld de hoeveelheid navulling en wat dat in praktijk dekt (afgeronde getallen).
- Sluit positieve punten af: gratis verzending, comfortabele buffer.

**Berekening "keer insmeren" — LAAT DE SERVER REKENEN:**
- Schrijf in je rationale de placeholder \`{{keer_insmeren}}\` waar het getal moet staan. De server berekent het correcte aantal en substitueert 'm.
- Voorbeeld-zin: "Met 2L navulling in totaal is dat ongeveer {{keer_insmeren}} keer insmeren."
- Formule (ter info, gebruikt door de server): \`liters_F30 × 850 + liters_F50 × 450\` = capaciteit van de geleverde crème (NIET seizoens-verbruik!).
- Ga NIET zelf rekenen — je hebt in het verleden herhaaldelijk fout gerekend door seizoens-verbruik te verwarren met fles-capaciteit. Als je toch een concreet getal schrijft, corrigeert de server 'm; maar de placeholder is schoner.

**Niet doen — vertaal deze interne termen:**
- "F50" → "SPF50". "F30" → "SPF30".
- "Verplicht" / "moet" → "aangeraden" / "geadviseerd".
- "Applicaties" / "doses" / "doseringen" → **"keer insmeren"** (altijd, geen andere variant).
- "navulling" prima, maar plaats het in context (bv. "6L navulling per dispenser geeft ruim voldoende voorraad voor het seizoen").
- Geen SKU-codes, geen rekenformules (\`× 25 zon-dagen\`), geen marge of inkoopprijs, geen interne overwegingen (Belgische klant, BTW, hiphot.eu).
- Geen "marge", "inkoop", "korting toegepast omdat …" (alleen positief: "inclusief korting").
- **Geen HTML-tags.** Schrijf platte tekst, geen \`<p>\`, \`<br>\` of andere tags — de offerte wraps zelf in opmaak.

**Voorbeeld goed:**
> Voor een basisschool met 175 kinderen die gelijktijdig buiten spelen. Drie dispensers met schoollogo dekken deze groep goed af over de school met 3 verdiepingen. Met 6L navulling in totaal is er ruim voldoende voorraad voor het hele seizoen — dat geeft zo'n {{keer_insmeren}} keer insmeren. Inclusief gratis verzending.

**Voorbeeld fout (jargon, intern, HTML):**
> \`<p>\`F50 verplicht voor kinderen. Berekening: 100 applicaties/dag × 25 zonnige dagen = 2500 applicaties seizoen ≈ 5L. Twee dispensers dekken 200 gebruikers goed af.\`</p>\`

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
    "rationale": "Klant-zichtbare toelichting van 2-4 zinnen — zie sectie RATIONALE hierboven voor stijl en vertalingen (SPF50 niet F50, 'aangeraden' niet 'verplicht', geen jargon)"
  }
}

Belangrijk:
- Prijzen ALTIJD in euro's, decimalen met punt (59.95 niet 59,95).
- \`discount_pct\` is 0-100. Pas alleen korting toe als de medewerker erom vraagt, of noem de mogelijkheid in message.
- \`shipping_cost\` in euro's. 0 als totaal >= €199 (gratis verzending).
- Als de medewerker een **informatieve vraag** stelt (bv. "wat is de marge?", "waarom deze SPF?", "hoeveel liter zit hierin?"), wijzig je de quote NIET. Geef in dat geval in \`quote\` exact de VORIGE state terug (zelfde line_items/discount/shipping/rationale als het laatste voorstel) en beantwoord de vraag in \`message\`.
- Als de vraag onduidelijk is of iets ontbreekt, zet \`quote\` gelijk aan de VORIGE state en stel de verduidelijkingsvraag in \`message\`.
- Als je SKU's weglaat of toevoegt bij een refinement, pas de volledige line_items array aan (geen diff).
- **NOOIT** tekst buiten het JSON-object schrijven — ook niet bij pure informatieve antwoorden. Het is altijd: JSON open-brace, object, JSON close-brace. Niks eromheen.`;
}

/**
 * Bouwt een context-string voor de eerste Claude-call op basis van geselecteerde items.
 * leadContext kan bevatten:
 *   - lead: { company_name, industry, city, contact_person, ... }
 *   - submissions: [{ source, conversation_data, message, contact }]
 *   - notes: [{ note_type, content, created_at, created_by }]
 *   - quotes: [{ quote_number, amount, status, created_at }] — oudere offertes ter referentie (read-only)
 */
export function buildLeadContextText(leadContext) {
  if (!leadContext) return "(geen context beschikbaar)";
  const parts = [];

  if (leadContext.lead) {
    const l = leadContext.lead;
    const leadLines = ["KLANT"];
    if (l.company_name) leadLines.push(`- Bedrijf: ${l.company_name}`);
    const naam = l.contact_person || [l.contact_first_name, l.contact_last_name].filter(Boolean).join(" ");
    if (naam) leadLines.push(`- Contactpersoon: ${naam}`);
    if (l.industry) leadLines.push(`- Branche: ${l.industry}`);
    if (l.city) leadLines.push(`- Plaats: ${l.city}${l.country && l.country !== "NL" ? `, ${l.country}` : ""}`);
    if (l.phone) leadLines.push(`- Telefoon: ${l.phone}`);
    parts.push(leadLines.join("\n"));
  }

  if (Array.isArray(leadContext.submissions) && leadContext.submissions.length > 0) {
    const lines = ["AANVRAGEN/FORMULIEREN (recent → oud)"];
    for (const s of leadContext.submissions) {
      lines.push(`\n— ${s.source || "form"} · ${s.created_at?.slice(0, 10) || ""} ${s.contact ? `(${s.contact})` : ""}`);
      if (s.conversation_data) {
        lines.push(`  Gestructureerde situatie:\n  ${JSON.stringify(s.conversation_data, null, 2).split("\n").join("\n  ")}`);
      } else if (s.message) {
        lines.push(`  ${String(s.message).slice(0, 1500)}`);
      }
    }
    parts.push(lines.join("\n"));
  }

  if (Array.isArray(leadContext.notes) && leadContext.notes.length > 0) {
    const lines = ["NOTITIES (recent → oud)"];
    for (const n of leadContext.notes) {
      const date = n.created_at?.slice(0, 10) || "";
      const who = n.created_by ? ` door ${n.created_by}` : "";
      lines.push(`\n— ${n.note_type || "notitie"} · ${date}${who}`);
      lines.push(`  ${String(n.content || "").slice(0, 1500)}`);
    }
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Genereer of verfijn een offerte-voorstel.
 *
 * @param {object} opts
 * @param {string} opts.tenant - 'hiphot' (voor lesson-retrieval-scope)
 * @param {object} opts.leadContext - genormaliseerde context (lead + submissions + notes)
 * @param {Array}  opts.history - Claude messages array, leeg bij eerste call
 * @param {string} opts.userMessage - de vraag/aanwijzing van de medewerker (null bij eerste call)
 * @param {object} opts.previousQuoteState - voor info-vragen fallback
 * @returns {Promise<{ ai_message: string, quote_state: object, history: Array, ... }>}
 */
export async function generateOrRefine({ tenant, leadContext, history, userMessage, previousQuoteState }) {
  const products = await getProductCatalog();
  if (products.length === 0) {
    return {
      error: "SKU-catalogus is leeg — draai eerst /api/hiphot/products/sync",
    };
  }

  // Haal relevante lessen op basis van context-tags (afgeleid van alle tekstvelden in leadContext)
  const tagSource = {
    situatie: {
      branche: leadContext?.lead?.industry,
      opmerkingen: [
        ...(leadContext?.submissions || []).map((s) => s.message).filter(Boolean),
        ...(leadContext?.notes || []).map((n) => n.content).filter(Boolean),
      ].join(" "),
    },
  };
  const tags = buildContextTags(tagSource);
  const lessons = tenant ? await fetchRelevantLessons({ tenant, tags, limit: 10 }) : [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt(products, lessons);

  // Bouw Claude messages
  const messages = [];
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) {
    // Eerste call: alle geselecteerde context als user-turn
    const contextText = buildLeadContextText(leadContext);
    messages.push({
      role: "user",
      content: `Hier is de context voor een offerte-advies. Gebruik ALLEEN deze info — negeer eventuele eerdere kennis over deze klant.

${contextText}

Stel een passend offerte-voorstel samen volgens de regels. Als essentiële info ontbreekt (aantal personen, buiten/binnen, plaatsing), stel dan in je message een of twee concrete vragen aan de medewerker voordat je een definitief voorstel doet.`,
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
    // Geen geldige JSON — val terug op raw tekst als info-antwoord, quote ongewijzigd.
    // Dit komt vooral voor bij vraag-en-antwoord zonder wijziging ("wat is de marge?", "hoeveel liter past hierin?").
    if (previousQuoteState) {
      const cleanMessage = rawText
        // Strip eventuele code-fences of losse braces die Claude toch produceerde
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim()
        .substring(0, 800);
      return {
        ai_message: cleanMessage || "(geen inhoud)",
        quote_state: previousQuoteState,
        history: [...messages, { role: "assistant", content: rawText }],
        warnings: [],
        lessons_used: lessons.length,
        quote_unchanged: true,
      };
    }
    // Geen vorige state (bijv. bij eerste call) → harde parse-fout.
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

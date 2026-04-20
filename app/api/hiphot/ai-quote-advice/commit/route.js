import { supabase } from "@/lib/supabase";
import { extractLessons, buildContextTags } from "@/lib/ai-lesson-extractor";

export const dynamic = "force-dynamic";
// Lesson-extraction doet een Claude call — bump timeout zodat die kan afronden
export const maxDuration = 60;

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const userName = decodeURIComponent(request.headers.get("x-auth-name") || "");
  const userId = request.headers.get("x-auth-user-id");

  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldige request body" }, { status: 400 });
  }

  const { lead_id, quote_state, chat_log, form_submission_id, initial_quote_state, learn } = body || {};

  if (!lead_id || !quote_state || !Array.isArray(quote_state.line_items) || quote_state.line_items.length === 0) {
    return Response.json(
      { error: "lead_id en quote_state.line_items zijn verplicht" },
      { status: 400 }
    );
  }

  // Verify lead bestaat en hoort bij tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id, tenant, company_name, contact_person, contact_first_name, contact_last_name, contact_function, email, phone, language")
    .eq("id", lead_id)
    .single();

  if (!lead || lead.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Bereken totalen
  const lineItems = quote_state.line_items.map((item, idx) => ({
    name: String(item.name || ""),
    sku: item.sku ? String(item.sku) : null,
    description: item.description || null,
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price || 0),
    discount_pct: 0,
    sort_order: idx,
  }));

  const discountPct = Number(quote_state.discount_pct) || 0;
  const shippingCost = Number(quote_state.shipping_cost) || 0;

  let subtotaalBrutoVerkoop = 0;
  for (const item of lineItems) {
    const line_total = Number((item.quantity * item.unit_price).toFixed(2));
    subtotaalBrutoVerkoop += line_total;
  }

  // Globale korting
  const globalDiscountAmount = Number((subtotaalBrutoVerkoop * (discountPct / 100)).toFixed(2));
  const nettoVerkoop = Number((subtotaalBrutoVerkoop - globalDiscountAmount).toFixed(2));
  const amountExclVat = Number((nettoVerkoop + shippingCost).toFixed(2));

  // Als er een korting is, pas die pro rata toe op de line_total van elke regel
  // zodat subtotaal + BTW in de offerte klopt
  lineItems.forEach((item) => {
    const gross = item.quantity * item.unit_price;
    const ratio = subtotaalBrutoVerkoop > 0 ? gross / subtotaalBrutoVerkoop : 0;
    const discounted = gross - globalDiscountAmount * ratio;
    item.line_total = Number(discounted.toFixed(2));
    if (discountPct > 0) item.discount_pct = discountPct;
  });

  // Genereer quote_number via RPC
  const { data: numData, error: numError } = await supabase.rpc("generate_quote_number");
  if (numError || !numData) {
    return Response.json(
      { error: `Kon quote-nummer niet genereren: ${numError?.message || "onbekend"}` },
      { status: 500 }
    );
  }
  const quote_number = numData;

  // Valid until: 30 dagen vanaf nu
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Haal afzender-gegevens op (de ingelogde HipHot-medewerker).
  // Deze vullen de contact_* velden op de quote, NIET de klant-gegevens.
  let sender = null;
  if (userId) {
    const { data } = await supabase
      .from("users")
      .select("name, email, phone")
      .eq("id", userId)
      .maybeSingle();
    sender = data || null;
  }

  // Insert quote
  const { data: newQuote, error: quoteErr } = await supabase
    .from("quotes")
    .insert({
      lead_id,
      quote_number,
      amount_excl_vat: amountExclVat,
      vat_percentage: 21.0,
      description: "Gegenereerd via AI offerte-advies",
      valid_until: validUntil,
      created_by: userName || null,
      tenant,
      quote_type: "simple",
      shipping_cost: shippingCost,
      shipping_discount_pct: 0,
      contact_name: sender?.name || userName || null,
      contact_title: null,
      contact_email: sender?.email || null,
      contact_phone: sender?.phone || null,
      language: lead.language || "nl",
      remarks_html: quote_state.rationale
        ? `<p><em>Onderbouwing AI-advies:</em> ${quote_state.rationale}</p>`
        : null,
      status: "concept",
    })
    .select()
    .single();

  if (quoteErr || !newQuote) {
    return Response.json(
      { error: `Kon offerte niet aanmaken: ${quoteErr?.message || "onbekend"}` },
      { status: 500 }
    );
  }

  // Enrich line items met article_id + wc_product_id via hiphot_articles lookup op SKU
  const skus = lineItems.map((l) => l.sku).filter(Boolean);
  let articlesBySku = {};
  if (skus.length > 0) {
    const { data: articles } = await supabase
      .from("hiphot_articles")
      .select("id, sku, wc_product_id, inkoop_price")
      .in("sku", skus);
    articlesBySku = Object.fromEntries((articles || []).map((a) => [a.sku, a]));
  }

  const lineItemsToInsert = lineItems.map((item) => {
    const article = item.sku ? articlesBySku[item.sku] : null;
    return {
      quote_id: newQuote.id,
      article_id: article?.id || null,
      wc_product_id: article?.wc_product_id || null,
      sku: item.sku,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_pct: item.discount_pct || 0,
      line_total: item.line_total,
      inkoop_price: article?.inkoop_price || null,
      sort_order: item.sort_order,
    };
  });

  const { error: linesErr } = await supabase.from("quote_line_items").insert(lineItemsToInsert);
  if (linesErr) {
    // Rollback: verwijder de lege quote zodat er geen weeskind achterblijft
    await supabase.from("quotes").delete().eq("id", newQuote.id);
    return Response.json(
      { error: `Kon regels niet opslaan: ${linesErr.message}` },
      { status: 500 }
    );
  }

  // Update lead estimated_value (som van alle non-rejected quotes)
  const { data: allQuotes } = await supabase
    .from("quotes")
    .select("amount_excl_vat")
    .eq("lead_id", lead_id)
    .not("status", "eq", "afgewezen");
  if (allQuotes?.length) {
    const totalValue = allQuotes.reduce((s, q) => s + (Number(q.amount_excl_vat) || 0), 0);
    await supabase.from("leads").update({ estimated_value: totalValue }).eq("id", lead_id);
  }

  // Audit note: chat-history + quote link
  if (Array.isArray(chat_log) && chat_log.length > 0) {
    const chatText = chat_log
      .map((m) => `**${m.from === "ai" ? "AI" : "Medewerker"}:** ${m.text}`)
      .join("\n\n");
    await supabase.from("notes").insert({
      lead_id,
      content: `**AI offerte-advies → offerte ${quote_number}**\n\n${chatText}${quote_state.rationale ? `\n\n---\n**Rationale:** ${quote_state.rationale}` : ""}`,
      note_type: "intern",
      created_by: userName || "AI offerte-advies",
      tenant,
    });
  }

  // Activity log
  await supabase.from("activities").insert({
    lead_id,
    activity_type: "quote_created",
    description: `Offerte ${quote_number} aangemaakt via AI offerte-advies`,
    metadata: {
      quote_id: newQuote.id,
      quote_number,
      generated_by: "ai_quote_advisor",
      form_submission_id: form_submission_id || null,
    },
    created_by: userName || "AI offerte-advies",
    tenant,
  });

  // Learning: extraheer lessen uit het verschil (alleen als agent opt-in aanvinkt)
  // Synchroon afhandelen — in Vercel serverless werkt fire-and-forget niet:
  // de function wordt gekild zodra de HTTP-response is teruggestuurd.
  let lessonsCreated = 0;
  let lessonsSkipped = 0;
  let extractError = null;
  let learningSkippedReason = null;

  if (learn !== true) {
    learningSkippedReason = "Leer-vinkje was niet aangevinkt";
  } else if (!initial_quote_state) {
    learningSkippedReason = "Geen initieel AI-voorstel bewaard (kan geen diff berekenen)";
  }

  if (learn === true && initial_quote_state) {
    try {
      // conversation_data is optioneel — alleen als deze lead een chatbot-submission heeft
      let conversationData = null;
      if (form_submission_id) {
        const { data: fs } = await supabase
          .from("form_submissions")
          .select("conversation_data")
          .eq("id", form_submission_id)
          .maybeSingle();
        conversationData = fs?.conversation_data || null;
      }
      // Fallback: geen chatbot-data? Bouw minimal context uit de lead zelf voor de extractor.
      if (!conversationData) {
        conversationData = {
          situatie: {
            branche: lead.industry || null,
            opmerkingen: `Lead ${lead.company_name || ""} — voorstel handmatig door medewerker aangepast.`,
          },
        };
      }

      const finalQuoteForExtract = {
        line_items: quote_state.line_items,
        discount_pct: quote_state.discount_pct || 0,
        shipping_cost: quote_state.shipping_cost || 0,
        rationale: quote_state.rationale || "",
      };

      console.log("[lesson-extractor] Starting for quote", newQuote.quote_number);
      const extractResult = await extractLessons({
        initialQuote: initial_quote_state,
        finalQuote: finalQuoteForExtract,
        chatLog: Array.isArray(chat_log) ? chat_log : [],
        conversationData,
      });
      // Compat: extractLessons kan nu een {lessons, skipReason} object zijn of een array
      const lessons = Array.isArray(extractResult)
        ? extractResult
        : extractResult?.lessons || [];
      const skipReason = Array.isArray(extractResult) ? null : extractResult?.skipReason || null;
      console.log("[lesson-extractor] Got", lessons.length, "lessons", skipReason ? `(skip: ${skipReason})` : "");
      if (skipReason && lessons.length === 0) {
        extractError = skipReason;
      }

      if (lessons && lessons.length > 0) {
        const extraTags = buildContextTags(conversationData);
        for (const l of lessons) {
          const mergedTags = [...new Set([...(l.context_tags || []), ...extraTags])].slice(0, 8);
          const { data: existing } = await supabase
            .from("ai_quote_lessons")
            .select("id, priority")
            .eq("tenant", tenant)
            .eq("lesson", l.lesson)
            .maybeSingle();

          if (existing) {
            await supabase
              .from("ai_quote_lessons")
              .update({
                priority: Math.min(10, (existing.priority || 5) + 1),
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            lessonsSkipped++;
          } else {
            const { error: insErr } = await supabase.from("ai_quote_lessons").insert({
              tenant,
              lesson: l.lesson,
              context_tags: mergedTags,
              priority: l.priority,
              is_active: true,
              source_quote_id: newQuote.id,
              source_submission_id: form_submission_id,
              initial_quote: initial_quote_state,
              final_quote: finalQuoteForExtract,
              chat_log: Array.isArray(chat_log) ? chat_log : [],
              created_by: userName || "AI offerte-advies",
            });
            if (insErr) {
              console.error("[lesson-extractor] insert failed:", insErr.message);
              extractError = insErr.message;
            } else {
              lessonsCreated++;
            }
          }
        }
      }
    } catch (err) {
      console.error("[lesson-extractor] synchronous failure:", err.message);
      extractError = err.message;
    }
  }

  // Combineer redenen voor transparantie in UI
  if (!extractError && learningSkippedReason) {
    extractError = learningSkippedReason;
  }

  return Response.json({
    success: true,
    quote_id: newQuote.id,
    quote_number,
    amount_excl_vat: amountExclVat,
    learning_triggered: learn === true,
    lessons_created: lessonsCreated,
    lessons_merged: lessonsSkipped,
    extract_error: extractError,
  });
}

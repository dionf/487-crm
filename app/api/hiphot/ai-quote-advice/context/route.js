import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/hiphot/ai-quote-advice/context?lead_id=...
 * Retourneert alle context-items die meegenomen KUNNEN worden in een AI offerte-advies,
 * plus een default-selectie volgens deze regel:
 *   - Als er al een offerte op deze lead bestaat: vink alleen items NA de laatste offerte aan
 *   - Anders: vink de laatste 5 items aan
 *   - form_submissions (chatbot/formulier/email) van ná de laatste offerte zijn altijd standaard aangevinkt
 */
export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("lead_id");
  if (!leadId) {
    return Response.json({ error: "lead_id is verplicht" }, { status: 400 });
  }

  // Verify lead bestaat en hoort bij tenant
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, tenant, company_name, contact_person, contact_first_name, contact_last_name, industry, city, billing_city, billing_country, email, phone")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead || lead.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Parallel fetches
  const [quotesRes, notesRes, submissionsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, created_at, quote_number, status, amount_excl_vat")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("notes")
      .select("id, created_at, note_type, content, created_by")
      .eq("lead_id", leadId)
      .in("note_type", ["gesprek", "intern", "formulier", "email", "todo"])
      .order("created_at", { ascending: false }),
    supabase
      .from("form_submissions")
      .select("id, created_at, source, message, conversation_data, first_name, last_name")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
  ]);

  const quotes = quotesRes.data || [];
  const notes = notesRes.data || [];
  const submissions = submissionsRes.data || [];

  // Cutoff: meest recente offerte, of null
  const lastQuoteAt = quotes.length > 0 ? quotes[0].created_at : null;

  // Default-selectie
  const isAfterLastQuote = (createdAt) =>
    !lastQuoteAt ? true : new Date(createdAt) > new Date(lastQuoteAt);

  const defaultNoteIds = [];
  if (lastQuoteAt) {
    // Na laatste offerte — alleen die aanvinken
    notes.forEach((n) => {
      if (isAfterLastQuote(n.created_at)) defaultNoteIds.push(n.id);
    });
  } else {
    // Geen offerte — laatste 5 notes
    notes.slice(0, 5).forEach((n) => defaultNoteIds.push(n.id));
  }

  // Form submissions: alle van ná laatste offerte, of alles als geen offerte
  const defaultSubmissionIds = submissions
    .filter((s) => isAfterLastQuote(s.created_at))
    .map((s) => s.id);

  return Response.json({
    lead: {
      id: lead.id,
      company_name: lead.company_name,
      contact_person: lead.contact_person,
      contact_first_name: lead.contact_first_name,
      contact_last_name: lead.contact_last_name,
      industry: lead.industry,
      city: lead.city || lead.billing_city,
      country: lead.billing_country || "NL",
      email: lead.email,
      phone: lead.phone,
    },
    notes: notes.map((n) => ({
      id: n.id,
      created_at: n.created_at,
      note_type: n.note_type,
      content: n.content,
      content_preview: (n.content || "").slice(0, 200),
      created_by: n.created_by,
    })),
    submissions: submissions.map((s) => ({
      id: s.id,
      created_at: s.created_at,
      source: s.source,
      message: s.message,
      message_preview: (s.message || "").slice(0, 200),
      has_structured_data: !!s.conversation_data,
      contact: [s.first_name, s.last_name].filter(Boolean).join(" "),
    })),
    last_quote_at: lastQuoteAt,
    default_selection: {
      note_ids: defaultNoteIds,
      submission_ids: defaultSubmissionIds,
    },
  });
}

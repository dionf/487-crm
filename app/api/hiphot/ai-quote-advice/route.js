import { supabase } from "@/lib/supabase";
import { generateOrRefine } from "@/lib/ai-quote-advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldige request body" }, { status: 400 });
  }

  const { form_submission_id, lead_id, history, message } = body || {};

  // Haal conversation_data op — óf via form_submission_id, óf via lead_id (nieuwste chatbot submission)
  let formSubmission = null;
  if (form_submission_id) {
    const { data } = await supabase
      .from("form_submissions")
      .select("id, lead_id, tenant, conversation_data, first_name, last_name, email")
      .eq("id", form_submission_id)
      .single();
    formSubmission = data;
  } else if (lead_id) {
    const { data } = await supabase
      .from("form_submissions")
      .select("id, lead_id, tenant, conversation_data, first_name, last_name, email")
      .eq("lead_id", lead_id)
      .eq("source", "chatbot")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    formSubmission = data;
  }

  if (!formSubmission) {
    return Response.json(
      { error: "Geen chatbot-submission gevonden voor deze lead" },
      { status: 404 }
    );
  }

  if (formSubmission.tenant !== tenant) {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  if (!formSubmission.conversation_data) {
    return Response.json(
      { error: "Chatbot-submission heeft geen gestructureerde data" },
      { status: 400 }
    );
  }

  const result = await generateOrRefine({
    conversationData: formSubmission.conversation_data,
    history: history || [],
    userMessage: message || null,
  });

  if (result.error) {
    return Response.json(
      { error: result.error, raw: result.raw || null },
      { status: 502 }
    );
  }

  return Response.json({
    ai_message: result.ai_message,
    quote_state: result.quote_state,
    history: result.history,
    warnings: result.warnings || [],
    form_submission_id: formSubmission.id,
    lead_id: formSubmission.lead_id,
  });
}

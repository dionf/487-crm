import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

export const dynamic = "force-dynamic";

function getResendKey(tenant) {
  if (tenant === "hiphot" && process.env.RESEND_API_KEY_HIPHOT) return process.env.RESEND_API_KEY_HIPHOT;
  if (tenant === "48-7" && process.env.RESEND_API_KEY_487) return process.env.RESEND_API_KEY_487;
  return process.env.RESEND_API_KEY;
}

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userName = decodeURIComponent(request.headers.get("x-auth-name") || "CRM");
  const { id } = await params;

  // Get submission
  const { data: submission } = await supabase
    .from("form_submissions")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (!submission) {
    return Response.json({ error: "Niet gevonden" }, { status: 404 });
  }

  const body = await request.json();
  const { subject, body_html } = body;

  if (!subject || !body_html) {
    return Response.json({ error: "Onderwerp en tekst zijn verplicht" }, { status: 400 });
  }

  const fromEmail = tenant === "hiphot" ? "hallo@hiphot.nl" : "hallo@48-7.nl";
  const fromName = tenant === "hiphot" ? "HipHot" : "48-7 AI Professionals";

  const resend = new Resend(getResendKey(tenant));

  try {
    const { data: resendData, error: resendError } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [submission.email],
      subject,
      html: wrapEmailHtml(body_html, { tenant }),
    });

    if (resendError) {
      return Response.json({ error: resendError.message }, { status: 500 });
    }

    // Update submission status
    const { error: updateError } = await supabase
      .from("form_submissions")
      .update({
        status: "beantwoord",
        replied_at: new Date().toISOString(),
        reply_subject: subject,
        reply_body_html: body_html,
        replied_by: userName,
      })
      .eq("id", id);

    if (updateError) {
      console.error("Failed to update form_submission status:", updateError);
    }

    // Log activity on linked lead
    if (submission.lead_id) {
      await supabase.from("activities").insert({
        lead_id: submission.lead_id,
        activity_type: "form_reply",
        description: `Antwoord op contactformulier verstuurd naar ${submission.email}`,
        metadata: { form_submission_id: id, resend_id: resendData?.id },
        created_by: userName,
        tenant,
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

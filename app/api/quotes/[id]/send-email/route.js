import { supabase } from "@/lib/supabase";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userName = decodeURIComponent(request.headers.get("x-auth-name") || "CRM");
  const { id } = await params;

  // Verify quote
  const { data: quote } = await supabase
    .from("quotes")
    .select("*, leads(id, company_name, contact_person, email, tenant)")
    .eq("id", id)
    .single();

  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const body = await request.json();
  const { to, cc, subject, body_html } = body;

  if (!to || !subject || !body_html) {
    return Response.json({ error: "to, subject en body_html zijn verplicht" }, { status: 400 });
  }

  // Determine sender based on tenant
  const fromEmail = tenant === "hiphot" ? "hallo@hiphot.nl" : "dion@48-7.nl";
  const fromName = tenant === "hiphot" ? "HipHot" : "48-7 AI Professionals";

  try {
    const emailData = {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html: body_html,
    };
    if (cc) emailData.cc = [cc];

    const { data: resendData, error: resendError } = await resend.emails.send(emailData);

    if (resendError) {
      return Response.json({ error: resendError.message }, { status: 500 });
    }

    // Save to quote_emails
    const { data: emailRecord } = await supabase
      .from("quote_emails")
      .insert({
        quote_id: id,
        lead_id: quote.lead_id,
        tenant,
        to_email: to,
        cc_email: cc || null,
        subject,
        body_html,
        language: quote.language || "nl",
        resend_id: resendData?.id || null,
        status: "sent",
        sent_by: userName,
      })
      .select()
      .single();

    // Log activity
    await supabase.from("activities").insert({
      lead_id: quote.lead_id,
      activity_type: "quote_emailed",
      description: `Offerte ${quote.quote_number} gemaild naar ${to}`,
      metadata: { quote_id: id, email_id: emailRecord?.id },
      created_by: userName,
      tenant,
    });

    return Response.json({ success: true, email: emailRecord });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

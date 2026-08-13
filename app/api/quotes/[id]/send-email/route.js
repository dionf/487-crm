import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

export const dynamic = "force-dynamic";

function getResendKey(tenant) {
  if (tenant === "hiphot" && process.env.RESEND_API_KEY_HIPHOT) {
    return process.env.RESEND_API_KEY_HIPHOT;
  }
  if (tenant === "48-7" && process.env.RESEND_API_KEY_487) {
    return process.env.RESEND_API_KEY_487;
  }
  return process.env.RESEND_API_KEY;
}

export async function POST(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const resend = new Resend(getResendKey(tenant));
  const userName = session.name || "CRM";
  const userId = session.user_id;
  const { id } = await params;

  // Verify quote
  const { data: quote } = await supabaseAdmin
    .from("quotes")
    .select("*, leads(id, company_name, contact_person, email, tenant)")
    .eq("id", id)
    .single();

  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const body = await request.json();
  const { to, cc, subject, body_html, attachment_ids, reminder_days } = body;

  if (!to || !subject || !body_html) {
    return Response.json({ error: "to, subject en body_html zijn verplicht" }, { status: 400 });
  }

  // Determine sender based on tenant
  const fromEmail = tenant === "hiphot" ? "hallo@hiphot.nl" : "dion@48-7.nl";
  const fromName = tenant === "hiphot" ? "HipHot" : "48-7 AI Professionals";

  try {
    // Fetch attachments if requested
    const attachments = [];
    const attachmentRecords = [];

    if (attachment_ids?.length) {
      const { data: stdAttachments } = await supabaseAdmin
        .from("email_standard_attachments")
        .select("*")
        .in("id", attachment_ids)
        .eq("tenant", tenant);

      for (const att of stdAttachments || []) {
        const { data: fileData, error: dlError } = await supabaseAdmin.storage
          .from("attachments")
          .download(att.storage_path);

        if (!dlError && fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          attachments.push({
            filename: att.file_name,
            content: buffer,
          });
          attachmentRecords.push({
            attachment_name: att.name,
            storage_path: att.storage_path,
            file_size: att.file_size,
          });
        }
      }
    }

    const emailData = {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html: wrapEmailHtml(body_html, { tenant }),
    };
    if (cc) emailData.cc = [cc];
    if (attachments.length) emailData.attachments = attachments;

    const { data: resendData, error: resendError } = await resend.emails.send(emailData);

    if (resendError) {
      return Response.json({ error: resendError.message }, { status: 500 });
    }

    // Save to quote_emails
    const { data: emailRecord } = await supabaseAdmin
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

    // Save attachment records
    if (emailRecord && attachmentRecords.length) {
      await supabaseAdmin.from("quote_email_attachments").insert(
        attachmentRecords.map((r) => ({ ...r, email_id: emailRecord.id }))
      );
    }

    // Auto-update quote status naar "verstuurd" (als die nog op concept of leeg staat)
    if (!quote.status || quote.status === "concept") {
      await supabaseAdmin
        .from("quotes")
        .update({ status: "verstuurd" })
        .eq("id", id);
    }

    // Auto-update lead status to "offerte gestuurd/verstuurd"
    const quoteStatusId = tenant === "hiphot" ? "offerte_gestuurd" : "offerte_verstuurd";
    const { data: currentLead } = await supabaseAdmin
      .from("leads")
      .select("status")
      .eq("id", quote.lead_id)
      .eq("tenant", tenant)
      .single();

    // Only upgrade status if lead is still in an early stage
    const earlyStatuses = ["prospect", "nieuwe_aanvraag", "nieuw", "contact_gelegd", "in_behandeling", "voorstel_fase"];
    if (currentLead && earlyStatuses.includes(currentLead.status)) {
      await supabaseAdmin
        .from("leads")
        .update({ status: quoteStatusId })
        .eq("tenant", tenant)
        .eq("id", quote.lead_id);
    }

    // Optional: schedule a reminder follow-up for the sender
    const validReminderDays = [3, 5].includes(Number(reminder_days)) ? Number(reminder_days) : null;
    if (validReminderDays && userId) {
      await supabaseAdmin.from("follow_up_tasks").insert({
        lead_id: quote.lead_id,
        task_type: "quote_reminder",
        description: `Offerte ${quote.quote_number} opvolgen`,
        due_date: new Date(Date.now() + validReminderDays * 24 * 60 * 60 * 1000).toISOString(),
        assigned_to: userId,
        tenant,
      });
    }

    // Log activity
    const attSuffix = attachmentRecords.length ? ` (${attachmentRecords.length} bijlage${attachmentRecords.length > 1 ? "n" : ""})` : "";
    const reminderSuffix = validReminderDays ? ` — herinnering over ${validReminderDays} dagen` : "";
    await supabaseAdmin.from("activities").insert({
      lead_id: quote.lead_id,
      activity_type: "quote_emailed",
      description: `Offerte ${quote.quote_number} gemaild naar ${to}${attSuffix}${reminderSuffix}`,
      metadata: { quote_id: id, email_id: emailRecord?.id, reminder_days: validReminderDays },
      created_by: userName,
      tenant,
    });

    return Response.json({ success: true, email: emailRecord });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

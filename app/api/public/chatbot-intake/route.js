import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

export const dynamic = "force-dynamic";

// Zelfde CORS-whitelist als form-submit (inclusief localhost voor dev)
const ALLOWED_ORIGINS = [
  "https://hiphot.nl",
  "https://www.hiphot.nl",
  "https://hiphot.eu",
  "https://www.hiphot.eu",
  "http://localhost:3000",
  "http://localhost:3001",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function getResendKey(tenant) {
  if (tenant === "hiphot" && process.env.RESEND_API_KEY_HIPHOT) return process.env.RESEND_API_KEY_HIPHOT;
  return process.env.RESEND_API_KEY;
}

// Alleen HipHot heeft (nu) een chatbot.
const TENANT_CONFIG = {
  hiphot: {
    fromEmail: "hallo@hiphot.nl",
    fromName: "HipHot",
    notifyEmail: "hallo@hiphot.nl",
  },
};

const CLOSINGS = {
  hiphot: {
    nl: "Met zonnige groet,",
    en: "With sunny regards,",
    de: "Mit sonnigen Grüßen,",
  },
};

const TRANSLATIONS = {
  nl: {
    confirmSubject: "Bedankt voor je adviesgesprek",
    confirmBody: (firstName, tenant) => `
      <p>Hallo ${firstName},</p>
      <p>Bedankt voor het adviesgesprek! We hebben je situatie ontvangen en maken snel een offerte op maat voor je.</p>
      <p>Een medewerker van HIPHOT neemt zo snel mogelijk contact met je op.</p>
      <p>${CLOSINGS[tenant]?.nl || CLOSINGS.hiphot.nl}</p>
    `,
  },
  en: {
    confirmSubject: "Thanks for your advice conversation",
    confirmBody: (firstName, tenant) => `
      <p>Hello ${firstName},</p>
      <p>Thanks for the advice conversation! We've received your situation and will prepare a tailored quote shortly.</p>
      <p>A HIPHOT team member will get in touch as soon as possible.</p>
      <p>${CLOSINGS[tenant]?.en || CLOSINGS.hiphot.en}</p>
    `,
  },
  de: {
    confirmSubject: "Danke für dein Beratungsgespräch",
    confirmBody: (firstName, tenant) => `
      <p>Hallo ${firstName},</p>
      <p>Danke für das Beratungsgespräch! Wir haben deine Situation erhalten und erstellen schnell ein Angebot.</p>
      <p>Ein HIPHOT Mitarbeiter meldet sich so schnell wie möglich.</p>
      <p>${CLOSINGS[tenant]?.de || CLOSINGS.hiphot.de}</p>
    `,
  },
};

// Bouwt een beknopte "message" samenvatting voor in de inbox-lijst
function buildMessageSummary({ company, situatie, opmerkingen }) {
  const lines = ["[Chatbot adviesgesprek]"];
  if (company) lines.push(`Bedrijf: ${company}`);
  if (situatie) {
    const sitParts = [];
    if (situatie.branche) sitParts.push(situatie.branche);
    if (situatie.aantal_medewerkers != null) sitParts.push(`${situatie.aantal_medewerkers} medewerkers`);
    if (situatie.binnen_buiten) sitParts.push(situatie.binnen_buiten);
    if (situatie.plaatsing) sitParts.push(situatie.plaatsing);
    if (situatie.custom_design && situatie.custom_design !== "nee") sitParts.push(`eigen ontwerp: ${situatie.custom_design}`);
    if (sitParts.length) lines.push(`Situatie: ${sitParts.join(", ")}`);
  }
  if (opmerkingen) lines.push(`Opmerkingen: ${opmerkingen}`);
  return lines.join("\n");
}

// Render key-value rijen voor de interne notificatie (skip lege/nullwaarden)
function renderDataRows(obj) {
  if (!obj || typeof obj !== "object") return "";
  const rows = [];
  const labels = {
    branche: "Branche",
    aantal_medewerkers: "Aantal medewerkers",
    binnen_buiten: "Binnen/Buiten",
    schaduw: "Schaduw",
    plaatsing: "Plaatsing",
    ondergrond: "Ondergrond",
    custom_design: "Eigen ontwerp/logo",
    opmerkingen: "Opmerkingen",
  };
  for (const [key, label] of Object.entries(labels)) {
    const v = obj[key];
    if (v == null || v === "") continue;
    const display = Array.isArray(v) ? v.join(", ") : String(v);
    rows.push(`
      <tr>
        <td style="padding:6px 0; color:#6b7280; width:160px; vertical-align:top;">${label}</td>
        <td style="padding:6px 0;">${display.replace(/\n/g, "<br>")}</td>
      </tr>
    `);
  }
  return rows.join("");
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  try {
    const body = await request.json();
    const {
      tenant, source_url, language, _hp, klant, situatie, advies, openstaande_vragen, transcript,
      gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer,
    } = body || {};

    // Honeypot
    if (_hp) {
      return Response.json({ success: true }, { headers });
    }

    // Tracking-attributie. Chatbot-widget moet deze meesturen vanuit cookies/URL.
    // Lege strings → null zodat we lead-data niet overschrijven met "" als een
    // latere submit zonder klik-context binnenkomt.
    const cleanTrack = (v) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t.slice(0, 500) : null;
    };
    const tracking = {
      gclid: cleanTrack(gclid),
      gbraid: cleanTrack(gbraid),
      wbraid: cleanTrack(wbraid),
      utm_source: cleanTrack(utm_source),
      utm_medium: cleanTrack(utm_medium),
      utm_campaign: cleanTrack(utm_campaign),
      utm_content: cleanTrack(utm_content),
      utm_term: cleanTrack(utm_term),
      referrer: cleanTrack(referrer),
      lead_type: "chatbot",
    };

    if (!tenant || !TENANT_CONFIG[tenant]) {
      return Response.json({ error: "Ongeldige tenant" }, { status: 400, headers });
    }

    const config = TENANT_CONFIG[tenant];
    const naam = (klant?.naam || "").trim();
    const emailRaw = (klant?.email || "").trim();
    const telefoon = (klant?.telefoon || "").trim();
    const bedrijf = (klant?.bedrijf || "").trim();

    if (!naam || !emailRaw) {
      return Response.json(
        { error: "klant.naam en klant.email zijn verplicht" },
        { status: 400, headers }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return Response.json({ error: "Ongeldig e-mailadres" }, { status: 400, headers });
    }

    const email = emailRaw.toLowerCase();

    // Rate limiting: max 5 submissions per e-mail per uur
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", oneHourAgo);

    if (count >= 5) {
      return Response.json(
        { error: "Te veel aanvragen. Probeer het later opnieuw." },
        { status: 429, headers }
      );
    }

    const lang = language || "nl";
    const nameParts = naam.split(/\s+/);
    const firstName = nameParts[0] || naam;
    const lastName = nameParts.slice(1).join(" ") || "";
    const fullName = naam;

    const messageSummary = buildMessageSummary({
      company: bedrijf,
      situatie,
      opmerkingen: situatie?.opmerkingen || null,
    });

    // 1. Zoek bestaande lead op e-mail
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant", tenant)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    let leadId = existingLead?.id;

    // 2. Maak nieuwe lead als niet gevonden
    if (!leadId) {
      const leadInsert = {
        company_name: bedrijf || `${fullName} (chatbot)`,
        contact_person: fullName,
        contact_first_name: firstName,
        contact_last_name: lastName,
        email,
        phone: telefoon || null,
        source: "chatbot",
        status: "nieuwe_aanvraag",
        language: lang,
        industry: situatie?.branche || null,
        tenant,
      };
      // Eerste-touchpoint wint (zie form-submit route voor toelichting).
      for (const [k, v] of Object.entries(tracking)) {
        if (v !== null) leadInsert[k] = v;
      }
      const { data: newLead } = await supabase
        .from("leads")
        .insert(leadInsert)
        .select("id")
        .single();

      leadId = newLead?.id;

      if (leadId) {
        await supabase.from("activities").insert({
          lead_id: leadId,
          activity_type: "lead_created",
          description: `Lead aangemaakt via chatbot adviesgesprek: ${fullName}`,
          created_by: "Chatbot",
          tenant,
        });
      }
    }

    // 3. Insert form_submission met rijke data + tracking-attributie van dit touchpoint
    const { data: submission } = await supabase
      .from("form_submissions")
      .insert({
        tenant,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: telefoon || null,
        message: messageSummary,
        language: lang,
        source_url: source_url || null,
        lead_id: leadId || null,
        status: "nieuw",
        source: "chatbot",
        conversation_transcript: transcript || null,
        conversation_data: {
          situatie: situatie || null,
          advies: advies || null,
          openstaande_vragen: Array.isArray(openstaande_vragen) ? openstaande_vragen : [],
        },
        ...tracking,
      })
      .select("id")
      .single();

    // 4. Note + activity op lead
    if (leadId) {
      const transcriptPreview = transcript
        ? `\n\n---\n**Transcript** (volledig in inbox):\n${String(transcript).slice(0, 800)}${String(transcript).length > 800 ? "…" : ""}`
        : "";
      await supabase.from("notes").insert({
        lead_id: leadId,
        content: `**Chatbot adviesgesprek**\n\n${messageSummary}${transcriptPreview}`,
        note_type: "formulier",
        tenant,
        created_by: "Chatbot",
      });

      await supabase.from("activities").insert({
        lead_id: leadId,
        activity_type: "form_submission",
        description: `Chatbot adviesgesprek voltooid door ${fullName}`,
        metadata: { form_submission_id: submission?.id, source: "chatbot" },
        created_by: "Chatbot",
        tenant,
      });
    }

    // 5. Bevestigingsmail aan klant
    const resend = new Resend(getResendKey(tenant));
    const t = TRANSLATIONS[lang] || TRANSLATIONS.nl;

    try {
      await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: [email],
        subject: t.confirmSubject,
        html: wrapEmailHtml(t.confirmBody(firstName, tenant), { tenant }),
      });
    } catch (emailErr) {
      console.error("Chatbot confirmation email failed:", emailErr);
    }

    // 6. Interne notificatie aan HipHot team
    const crmUrl = `https://crm.48-7.nl/inbox?id=${submission?.id}`;
    const leadUrl = leadId ? `https://crm.48-7.nl/leads/${leadId}` : null;
    const situatieRows = renderDataRows(situatie);
    const openstaandeList = Array.isArray(openstaande_vragen) && openstaande_vragen.length
      ? `<ul style="margin:8px 0 0; padding-left:20px; color:#374151;">
          ${openstaande_vragen.map((q) => `<li style="margin:4px 0;">${String(q).replace(/</g, "&lt;")}</li>`).join("")}
        </ul>`
      : "";

    try {
      await resend.emails.send({
        from: `${config.fromName} CRM <${config.fromEmail}>`,
        to: [config.notifyEmail],
        subject: `Nieuw adviesgesprek — ${fullName}`,
        html: wrapEmailHtml(`
          <h2 style="margin:0 0 16px; font-size:18px; color:#1a1a1a;">Nieuw chatbot adviesgesprek</h2>
          <table style="width:100%; font-size:14px; color:#374151; border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0; color:#6b7280; width:160px; vertical-align:top;">Naam</td>
              <td style="padding:8px 0; font-weight:600;">${fullName}</td>
            </tr>
            ${bedrijf ? `<tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Bedrijf</td>
              <td style="padding:8px 0;">${bedrijf}</td>
            </tr>` : ""}
            <tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">E-mail</td>
              <td style="padding:8px 0;"><a href="mailto:${email}" style="color:#d97706;">${email}</a></td>
            </tr>
            ${telefoon ? `<tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Telefoon</td>
              <td style="padding:8px 0;"><a href="tel:${telefoon}" style="color:#d97706;">${telefoon}</a></td>
            </tr>` : ""}
            ${source_url ? `<tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Pagina</td>
              <td style="padding:8px 0; font-size:12px; color:#9ca3af;">${source_url}</td>
            </tr>` : ""}
          </table>

          ${situatieRows ? `
          <h3 style="margin:24px 0 8px; font-size:15px; color:#1a1a1a;">Situatie</h3>
          <table style="width:100%; font-size:13px; color:#374151; border-collapse:collapse;">
            ${situatieRows}
          </table>` : ""}

          ${openstaandeList ? `
          <h3 style="margin:24px 0 4px; font-size:15px; color:#b45309;">⚠️ Openstaande vragen</h3>
          ${openstaandeList}` : ""}

          <div style="margin-top:24px;">
            <a href="${crmUrl}" style="display:inline-block; background:#FFD500; color:#0D0D0F; font-weight:600; padding:10px 24px; border-radius:999px; text-decoration:none; font-size:14px;">
              Bekijk in CRM
            </a>
            ${leadUrl ? `<a href="${leadUrl}" style="display:inline-block; background:#f3f4f6; color:#374151; font-weight:500; padding:10px 24px; border-radius:999px; text-decoration:none; font-size:14px; margin-left:8px;">
              Bekijk lead
            </a>` : ""}
          </div>
        `, { tenant }),
      });
    } catch (notifyErr) {
      console.error("Chatbot team notification failed:", notifyErr);
    }

    return Response.json(
      { success: true, submission_id: submission?.id, lead_id: leadId },
      { status: 201, headers }
    );
  } catch (err) {
    console.error("Chatbot intake error:", err);
    return Response.json(
      { error: "Er ging iets mis" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

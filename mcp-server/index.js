#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// --- Supabase client ---
const supabaseUrl = process.env.CRM487_SUPABASE_URL || "https://olzyffwotjtyvupomoiz.supabase.co";
const supabaseKey = process.env.CRM487_SUPABASE_KEY;

if (!supabaseKey) {
  console.error("CRM487_SUPABASE_KEY is required");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- MCP Server ---
const server = new McpServer({
  name: "487crm",
  version: "1.0.0",
  description: "STANDALONE 48-7 CRM systeem met eigen database-verbinding. Voor ALLE taken die gaan over 48-7 leads, offertes, notities en pipeline: gebruik ALLEEN deze 487crm tools. Niet Supabase MCP, niet HubSpot (dat is voor HipHot). Dit is de eigen CRM van 48-7 AI Professionals op https://crm.48-7.nl.",
});

// ==================== TOOLS ====================

// --- Search leads ---
server.tool(
  "crm_search_leads",
  "Zoek leads in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig). Zoekt op bedrijfsnaam, contactpersoon en email.",
  { query: z.string().optional().describe("Zoekterm (bedrijfsnaam, contactpersoon, email)"),
    status: z.string().optional().describe("Filter op status: nieuw, gekwalificeerd, inventarisatie, offerte_verstuurd, onderhandeling, gewonnen, verloren"),
    service_type: z.string().optional().describe("Filter op service type: discovery, cowork_setup, training, maatwerk, support_contract, partner"),
  },
  async ({ query, status, service_type }) => {
    let q = supabase.from("leads").select("id, company_name, contact_person, email, phone, status, service_type, estimated_value, source, website_url, created_at").order("created_at", { ascending: false }).limit(25);
    if (query) q = q.or(`company_name.ilike.%${query}%,contact_person.ilike.%${query}%,email.ilike.%${query}%`);
    if (status) q = q.eq("status", status);
    if (service_type) q = q.eq("service_type", service_type);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };
    if (!data?.length) return { content: [{ type: "text", text: "Geen leads gevonden." }] };
    const lines = data.map(l =>
      `• **${l.company_name}** (${l.status}) — ${l.contact_person} — ${l.email}${l.estimated_value ? ` — €${l.estimated_value}` : ""}${l.service_type ? ` — ${l.service_type}` : ""}`
    );
    return { content: [{ type: "text", text: `**${data.length} leads gevonden:**\n\n${lines.join("\n")}` }] };
  }
);

// --- Get lead detail ---
server.tool(
  "crm_get_lead",
  "Haal volledige details van een lead op inclusief notities, offertes en activiteiten (STANDALONE — geen Supabase MCP nodig).",
  { lead_id: z.string().optional().describe("UUID van de lead"),
    company_name: z.string().optional().describe("Bedrijfsnaam om op te zoeken (als je geen ID hebt)"),
  },
  async ({ lead_id, company_name }) => {
    let leadData;
    if (lead_id) {
      const { data } = await supabase.from("leads").select("*").eq("id", lead_id).single();
      leadData = data;
    } else if (company_name) {
      const { data } = await supabase.from("leads").select("*").ilike("company_name", `%${company_name}%`).limit(1).single();
      leadData = data;
    }
    if (!leadData) return { content: [{ type: "text", text: "Lead niet gevonden." }] };

    const [notesRes, quotesRes, activitiesRes, attachRes] = await Promise.all([
      supabase.from("notes").select("*").eq("lead_id", leadData.id).order("created_at", { ascending: false }),
      supabase.from("quotes").select("*").eq("lead_id", leadData.id).order("created_at", { ascending: false }),
      supabase.from("activities").select("*").eq("lead_id", leadData.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("attachments").select("*").eq("lead_id", leadData.id).order("created_at", { ascending: false }),
    ]);

    const notes = notesRes.data || [];
    const quotes = quotesRes.data || [];
    const activities = activitiesRes.data || [];
    const attachments = attachRes.data || [];

    let text = `# ${leadData.company_name}\n`;
    text += `**Status:** ${leadData.status}\n`;
    text += `**Contact:** ${leadData.contact_person} — ${leadData.email}${leadData.phone ? ` — ${leadData.phone}` : ""}\n`;
    if (leadData.service_type) text += `**Service:** ${leadData.service_type}\n`;
    if (leadData.estimated_value) text += `**Waarde:** €${leadData.estimated_value}\n`;
    if (leadData.source) text += `**Bron:** ${leadData.source}\n`;
    if (leadData.website_url) text += `**Website:** ${leadData.website_url}\n`;
    if (leadData.ai_summary) text += `\n**AI Analyse:**\n${leadData.ai_summary}\n`;

    if (quotes.length) {
      text += `\n## Offertes (${quotes.length})\n`;
      quotes.forEach(q => {
        text += `• ${q.quote_number} — €${q.amount_excl_vat} — ${q.status}${q.description ? ` — ${q.description}` : ""}\n`;
      });
    }

    if (notes.length) {
      text += `\n## Notities (${notes.length})\n`;
      notes.slice(0, 10).forEach(n => {
        const date = new Date(n.created_at).toLocaleDateString("nl-NL");
        text += `• [${n.note_type}] ${n.content.substring(0, 150)}${n.content.length > 150 ? "..." : ""} (${date}${n.created_by ? ` door ${n.created_by}` : ""})\n`;
      });
    }

    if (attachments.length) {
      text += `\n## Bijlagen (${attachments.length})\n`;
      attachments.forEach(a => {
        const size = a.file_size ? `${Math.round(a.file_size / 1024)} KB` : "";
        text += `• ${a.filename}${size ? ` (${size})` : ""}${a.description ? ` — ${a.description}` : ""}${a.file_url ? `\n  URL: ${a.file_url}` : ""}\n`;
      });
    }

    if (activities.length) {
      text += `\n## Recente activiteiten\n`;
      activities.slice(0, 5).forEach(a => {
        const date = new Date(a.created_at).toLocaleDateString("nl-NL");
        text += `• ${a.description} (${date})\n`;
      });
    }

    return { content: [{ type: "text", text }] };
  }
);

// --- Create lead ---
server.tool(
  "crm_create_lead",
  "Maak een nieuwe lead aan in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig).",
  {
    company_name: z.string().describe("Bedrijfsnaam"),
    contact_person: z.string().describe("Naam contactpersoon"),
    email: z.string().describe("Email adres"),
    phone: z.string().optional().describe("Telefoonnummer"),
    service_type: z.string().optional().describe("Service type: discovery, cowork_setup, training, maatwerk, support_contract, partner"),
    estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
    source: z.string().optional().describe("Bron: linkedin, website, referral, partner, event, overig"),
  },
  async ({ company_name, contact_person, email, phone, service_type, estimated_value, source }) => {
    const { data, error } = await supabase.from("leads").insert({
      company_name, contact_person, email, phone, service_type, estimated_value,
      source: source || "overig", status: "nieuw",
    }).select().single();
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };

    await supabase.from("activities").insert({
      lead_id: data.id, activity_type: "lead_created",
      description: `Lead aangemaakt: ${company_name}`, created_by: "MCP",
    });

    return { content: [{ type: "text", text: `Lead aangemaakt: **${company_name}** (${data.id})\nStatus: nieuw` }] };
  }
);

// --- Update lead status ---
server.tool(
  "crm_update_lead",
  "Werk een lead bij — status, waarde, contactgegevens, etc. (STANDALONE — geen Supabase MCP nodig).",
  {
    lead_id: z.string().optional().describe("UUID van de lead"),
    company_name: z.string().optional().describe("Bedrijfsnaam (om lead te vinden als je geen ID hebt)"),
    status: z.string().optional().describe("Nieuwe status: nieuw, gekwalificeerd, inventarisatie, offerte_verstuurd, onderhandeling, gewonnen, verloren"),
    estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
    phone: z.string().optional().describe("Telefoonnummer"),
    service_type: z.string().optional().describe("Service type"),
    source: z.string().optional().describe("Bron"),
    website_url: z.string().optional().describe("Website URL"),
  },
  async ({ lead_id, company_name, ...updates }) => {
    // Find lead
    let id = lead_id;
    if (!id && company_name) {
      const { data } = await supabase.from("leads").select("id").ilike("company_name", `%${company_name}%`).limit(1).single();
      if (data) id = data.id;
    }
    if (!id) return { content: [{ type: "text", text: "Lead niet gevonden." }] };

    // Clean empty values
    const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined && v !== ""));
    if (cleanUpdates.status === "gewonnen") cleanUpdates.won_at = new Date().toISOString();

    const { data, error } = await supabase.from("leads").update(cleanUpdates).eq("id", id).select().single();
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };

    const changed = Object.keys(cleanUpdates).join(", ");
    return { content: [{ type: "text", text: `Lead **${data.company_name}** bijgewerkt: ${changed}` }] };
  }
);

// --- Add note ---
server.tool(
  "crm_add_note",
  "Voeg een notitie toe aan een lead in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig).",
  {
    lead_id: z.string().optional().describe("UUID van de lead"),
    company_name: z.string().optional().describe("Bedrijfsnaam (als je geen ID hebt)"),
    content: z.string().describe("Inhoud van de notitie"),
    note_type: z.string().optional().describe("Type: gesprek, email, intern, inventarisatie, todo").default("intern"),
    due_date: z.string().optional().describe("Deadline (ISO datum, alleen voor todo's)"),
  },
  async ({ lead_id, company_name, content, note_type, due_date }) => {
    let id = lead_id;
    if (!id && company_name) {
      const { data } = await supabase.from("leads").select("id").ilike("company_name", `%${company_name}%`).limit(1).single();
      if (data) id = data.id;
    }
    if (!id) return { content: [{ type: "text", text: "Lead niet gevonden." }] };

    const insert = { lead_id: id, content, note_type, created_by: "MCP" };
    if (note_type === "todo") {
      insert.is_completed = false;
      if (due_date) insert.due_date = due_date;
    }

    const { error } = await supabase.from("notes").insert(insert);
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };

    await supabase.from("activities").insert({
      lead_id: id, activity_type: "note_added",
      description: `Notitie toegevoegd (${note_type})`, created_by: "MCP",
    });

    return { content: [{ type: "text", text: `Notitie toegevoegd (${note_type}): "${content.substring(0, 80)}..."` }] };
  }
);

// --- List open todos ---
server.tool(
  "crm_list_todos",
  "Toon alle openstaande to-do's in de 48-7 CRM, gesorteerd op deadline (STANDALONE — geen Supabase MCP nodig).",
  {
    user: z.string().optional().describe("Filter op gebruiker (bijv. Dion, Jaap, Serge)"),
  },
  async ({ user }) => {
    let q = supabase.from("notes").select("id, content, due_date, created_by, created_at, lead_id, leads(company_name)")
      .eq("note_type", "todo").eq("is_completed", false)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (user) q = q.eq("created_by", user);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };
    if (!data?.length) return { content: [{ type: "text", text: "Geen openstaande to-do's." }] };

    const now = new Date();
    const lines = data.map(t => {
      const overdue = t.due_date && new Date(t.due_date) < now;
      const due = t.due_date ? new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "geen deadline";
      return `${overdue ? "🔴" : "⬜"} **${t.content}** — ${t.leads?.company_name || "?"} — ${due}${t.created_by ? ` (${t.created_by})` : ""}`;
    });

    return { content: [{ type: "text", text: `**${data.length} openstaande to-do's:**\n\n${lines.join("\n")}` }] };
  }
);

// --- List follow-up tasks ---
server.tool(
  "crm_list_follow_ups",
  "Toon alle openstaande follow-up taken in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig).",
  {},
  async () => {
    const { data, error } = await supabase.from("follow_up_tasks")
      .select("*, leads(company_name, contact_person)")
      .eq("is_completed", false)
      .order("due_date", { ascending: true });
    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };
    if (!data?.length) return { content: [{ type: "text", text: "Geen openstaande follow-ups." }] };

    const lines = data.map(t => {
      const due = new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
      return `• **${t.description}** — ${t.leads?.company_name || "?"} — ${due} — type: ${t.task_type}`;
    });

    return { content: [{ type: "text", text: `**${data.length} openstaande follow-ups:**\n\n${lines.join("\n")}` }] };
  }
);

// --- Pipeline metrics ---
server.tool(
  "crm_pipeline_metrics",
  "Toon pipeline statistieken van de 48-7 CRM: win rate, waarde, cyclustijd per service type (STANDALONE — geen Supabase MCP nodig).",
  {},
  async () => {
    const { data: leads } = await supabase.from("leads").select("status, service_type, estimated_value, created_at, won_at, updated_at");
    if (!leads?.length) return { content: [{ type: "text", text: "Geen data beschikbaar." }] };

    const active = leads.filter(l => !["gewonnen", "verloren"].includes(l.status));
    const won = leads.filter(l => l.status === "gewonnen");
    const lost = leads.filter(l => l.status === "verloren");
    const pipelineValue = active.reduce((s, l) => s + (parseFloat(l.estimated_value) || 0), 0);
    const wonValue = won.reduce((s, l) => s + (parseFloat(l.estimated_value) || 0), 0);
    const winRate = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

    let text = `# Pipeline Overzicht\n\n`;
    text += `• **Actieve leads:** ${active.length} (€${pipelineValue.toLocaleString("nl-NL")})\n`;
    text += `• **Gewonnen:** ${won.length} (€${wonValue.toLocaleString("nl-NL")})\n`;
    text += `• **Verloren:** ${lost.length}\n`;
    text += `• **Win rate:** ${winRate}%\n`;
    text += `• **Totaal leads:** ${leads.length}\n`;

    // Per service type
    const byType = {};
    leads.forEach(l => {
      const t = l.service_type || "onbekend";
      if (!byType[t]) byType[t] = { total: 0, won: 0, lost: 0, value: 0 };
      byType[t].total++;
      if (l.status === "gewonnen") byType[t].won++;
      if (l.status === "verloren") byType[t].lost++;
      byType[t].value += parseFloat(l.estimated_value) || 0;
    });

    text += `\n## Per Service Type\n`;
    Object.entries(byType).forEach(([type, d]) => {
      const wr = d.won + d.lost > 0 ? Math.round(d.won / (d.won + d.lost) * 100) : "-";
      text += `• **${type}**: ${d.total} leads — €${d.value.toLocaleString("nl-NL")} — win rate: ${wr}%\n`;
    });

    return { content: [{ type: "text", text }] };
  }
);

// --- Create quote ---
server.tool(
  "crm_create_quote",
  "Maak een offerte aan voor een lead in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig).",
  {
    lead_id: z.string().optional().describe("UUID van de lead"),
    company_name: z.string().optional().describe("Bedrijfsnaam (als je geen ID hebt)"),
    amount: z.number().describe("Bedrag excl. BTW"),
    description: z.string().optional().describe("Omschrijving van de offerte"),
    vat_percentage: z.number().optional().describe("BTW percentage (default 21)").default(21),
  },
  async ({ lead_id, company_name, amount, description, vat_percentage }) => {
    let id = lead_id;
    if (!id && company_name) {
      const { data } = await supabase.from("leads").select("id").ilike("company_name", `%${company_name}%`).limit(1).single();
      if (data) id = data.id;
    }
    if (!id) return { content: [{ type: "text", text: "Lead niet gevonden." }] };

    // Generate quote number
    const { data: qNum } = await supabase.rpc("generate_quote_number");
    const quoteNumber = qNum || `OFT-${Date.now()}`;

    const { data, error } = await supabase.from("quotes").insert({
      lead_id: id, quote_number: quoteNumber, amount_excl_vat: amount,
      vat_percentage, description, status: "concept", created_by: "MCP",
    }).select().single();

    if (error) return { content: [{ type: "text", text: `Fout: ${error.message}` }] };

    await supabase.from("activities").insert({
      lead_id: id, activity_type: "quote_created",
      description: `Offerte ${quoteNumber} aangemaakt (€${amount} excl. BTW)`, created_by: "MCP",
    });

    return { content: [{ type: "text", text: `Offerte aangemaakt: **${quoteNumber}** — €${amount} excl. BTW${description ? ` — ${description}` : ""}\nStatus: concept` }] };
  }
);

// --- Add attachment ---
server.tool(
  "crm_add_attachment",
  "Upload een bestand (PDF, afbeelding, etc.) als bijlage bij een lead in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig). Accepteert zowel een lokaal file_path als base64 file_content.",
  {
    lead_id: z.string().optional().describe("UUID van de lead"),
    company_name: z.string().optional().describe("Bedrijfsnaam (als je geen ID hebt)"),
    file_path: z.string().optional().describe("Absoluut pad naar het bestand op schijf (voor lokale MCP)"),
    file_content: z.string().optional().describe("Base64-encoded bestandsinhoud (voor remote/Claude Chat)"),
    filename: z.string().optional().describe("Bestandsnaam incl. extensie (verplicht bij file_content)"),
    description: z.string().optional().describe("Beschrijving van het bestand"),
  },
  async ({ lead_id, company_name, file_path, file_content, filename, description }) => {
    // Find lead
    let id = lead_id;
    if (!id && company_name) {
      const { data } = await supabase.from("leads").select("id, company_name").ilike("company_name", `%${company_name}%`).limit(1).single();
      if (data) { id = data.id; company_name = data.company_name; }
    }
    if (!id) return { content: [{ type: "text", text: "Lead niet gevonden." }] };

    // Get file buffer from either base64 content or file path
    let fileBuffer;
    if (file_content) {
      try {
        fileBuffer = Buffer.from(file_content, "base64");
      } catch {
        return { content: [{ type: "text", text: "Ongeldige base64 content." }] };
      }
      if (!filename) return { content: [{ type: "text", text: "filename is verplicht bij file_content." }] };
    } else if (file_path) {
      try {
        fileBuffer = await readFile(file_path);
      } catch {
        return { content: [{ type: "text", text: `Bestand niet gevonden: ${file_path}` }] };
      }
    } else {
      return { content: [{ type: "text", text: "Geef file_path of file_content (base64) mee." }] };
    }

    const name = filename || basename(file_path || "bestand");
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const mimeTypes = {
      pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp",
      doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      json: "application/json", html: "text/html", txt: "text/plain", csv: "text/csv",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";
    const storagePath = `leads/${id}/${Date.now()}_${name}`;

    // Upload to Supabase Storage (bucket = "attachments")
    const { error: uploadError } = await supabase.storage
      .from("attachments")
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

    if (uploadError) return { content: [{ type: "text", text: `Upload mislukt: ${uploadError.message}` }] };

    // Get public URL
    const { data: urlData } = supabase.storage.from("attachments").getPublicUrl(storagePath);
    const fileUrl = urlData?.publicUrl || "";

    // Insert in attachments table
    const { data: attachment, error: dbError } = await supabase.from("attachments").insert({
      lead_id: id,
      filename: name,
      file_url: fileUrl,
      file_size: fileBuffer.length,
      mime_type: mimeType,
      description: description || null,
      uploaded_by: "MCP",
    }).select().single();

    if (dbError) return { content: [{ type: "text", text: `Database fout: ${dbError.message}` }] };

    // Log activity
    await supabase.from("activities").insert({
      lead_id: id, activity_type: "attachment_added",
      description: `Bijlage toegevoegd: ${name}${description ? ` (${description})` : ""}`,
      created_by: "MCP",
    });

    const sizeKb = Math.round(fileBuffer.length / 1024);
    return { content: [{ type: "text", text: `Bijlage toegevoegd aan ${company_name || "lead"}: **${name}** (${sizeKb} KB)\nURL: ${fileUrl}` }] };
  }
);

// --- Trigger inbox poll ---
server.tool(
  "crm_check_inbox",
  "Check de leads@48-7.nl inbox voor nieuwe emails en verwerk ze tot leads in de 48-7 CRM (STANDALONE — geen Supabase MCP nodig).",
  {},
  async () => {
    const appUrl = process.env.CRM487_APP_URL || "https://487crm.vercel.app";
    const cronSecret = process.env.CRM487_CRON_SECRET;
    try {
      const res = await fetch(`${appUrl}/api/poll-inbox`, {
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
      });
      const data = await res.json();
      if (data.error) return { content: [{ type: "text", text: `Fout: ${data.error} — ${data.detail || ""}` }] };
      return { content: [{ type: "text", text: `Inbox gecheckt: **${data.processed || 0}** emails verwerkt.${data.results?.length ? "\n" + data.results.map(r => `• ${r.email_subject} → ${r.status}`).join("\n") : ""}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Fout bij inbox check: ${err.message}` }] };
    }
  }
);

// ==================== START ====================
const transport = new StdioServerTransport();
await server.connect(transport);

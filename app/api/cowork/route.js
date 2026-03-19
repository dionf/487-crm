import { supabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const SYSTEM_PROMPT = `Je bent de Cowork assistent voor het 48-7 CRM systeem. Je helpt met lead management via natural language commands.

Beschikbare acties die je kunt uitvoeren:
- list_leads: Toon leads (optioneel: filter op status of service_type)
- get_lead_detail: Details van een specifieke lead (zoek op bedrijfsnaam)
- create_lead: Maak een nieuwe lead aan
- update_status: Wijzig de status van een lead
- add_note: Voeg een notitie toe aan een lead
- get_stats: Toon pipeline statistieken
- create_quote: Maak een offerte aan voor een lead
- get_open_todos: Toon alle open to-do's over alle leads
- check_inbox: Check de email inbox (leads@48-7.nl) voor nieuwe leads

Statussen: nieuw, gekwalificeerd, inventarisatie, offerte_verstuurd, onderhandeling, gewonnen, verloren
Service types: cowork_setup, training, maatwerk, support_contract, partner

Reageer ALTIJD in JSON format:
{
  "action": "action_name",
  "params": { ... relevant parameters ... },
  "message": "Menselijke beschrijving van wat je doet"
}

Voorbeelden:
- "toon leads" → {"action": "list_leads", "params": {}, "message": "Alle leads ophalen..."}
- "status Enablemi naar gewonnen" → {"action": "update_status", "params": {"company_name": "Enablemi", "new_status": "gewonnen"}, "message": "Status van Enablemi wijzigen naar gewonnen..."}
- "nieuwe lead TechBV" → {"action": "create_lead", "params": {"company_name": "TechBV"}, "message": "Nieuwe lead aanmaken voor TechBV. Welke contactgegevens heb je?"}
- "rapportage" → {"action": "get_stats", "params": {}, "message": "Pipeline statistieken ophalen..."}
- "notitie Enablemi: demo was succesvol" → {"action": "add_note", "params": {"company_name": "Enablemi", "content": "demo was succesvol", "note_type": "gesprek"}, "message": "Notitie toegevoegd aan Enablemi"}
- "maak offerte voor Enablemi van 5000 voor Cowork setup" → {"action": "create_quote", "params": {"company_name": "Enablemi", "amount": 5000, "description": "Cowork setup"}, "message": "Offerte aanmaken voor Enablemi..."}
- "offerte 2M Recruitment 12000 RADAR platform" → {"action": "create_quote", "params": {"company_name": "2M Recruitment", "amount": 12000, "description": "RADAR platform"}, "message": "Offerte aanmaken voor 2M Recruitment..."}
- "check inbox" → {"action": "check_inbox", "params": {}, "message": "Email inbox checken voor nieuwe leads..."}
- "update mailbox" → {"action": "check_inbox", "params": {}, "message": "Mailbox updaten..."}`;


// Fallback regex parser when no API key
function parseCommand(command) {
  const lower = command.toLowerCase().trim();

  if (/^(toon leads|overzicht|pipeline|alle leads)/i.test(lower)) {
    return { action: "list_leads", params: {}, message: "Leads ophalen..." };
  }

  const statusMatch = lower.match(/status\s+(.+?)\s+naar\s+(.+)/i);
  if (statusMatch) {
    return {
      action: "update_status",
      params: { company_name: statusMatch[1], new_status: statusMatch[2] },
      message: `Status wijzigen...`,
    };
  }

  const noteMatch = lower.match(/notitie\s+(.+?):\s+(.+)/i);
  if (noteMatch) {
    return {
      action: "add_note",
      params: { company_name: noteMatch[1], content: noteMatch[2], note_type: "gesprek" },
      message: `Notitie toevoegen...`,
    };
  }

  // Quote creation patterns
  // "maak offerte voor Enablemi van 5000 voor Cowork setup"
  // "offerte Enablemi 5000 cowork setup"
  const quoteMatch1 = command.match(/(?:maak\s+)?offerte\s+(?:voor\s+)?(.+?)\s+(?:van\s+)?[€]?\s*(\d+[\d.,]*)\s*(?:voor\s+)?(.+)?/i);
  if (quoteMatch1) {
    const amount = parseFloat(quoteMatch1[2].replace(/\./g, "").replace(",", "."));
    return {
      action: "create_quote",
      params: {
        company_name: quoteMatch1[1].trim(),
        amount,
        description: quoteMatch1[3]?.trim() || null,
      },
      message: `Offerte aanmaken voor ${quoteMatch1[1].trim()}...`,
    };
  }

  const newLeadMatch = lower.match(/nieuwe lead\s+(.+)/i);
  if (newLeadMatch) {
    return {
      action: "create_lead",
      params: { company_name: newLeadMatch[1] },
      message: `Nieuwe lead aanmaken voor ${newLeadMatch[1]}...`,
    };
  }

  const detailMatch = lower.match(/^(details|open|bekijk)\s+(.+)/i);
  if (detailMatch) {
    return {
      action: "get_lead_detail",
      params: { company_name: detailMatch[2] },
      message: `Details ophalen...`,
    };
  }

  if (/^(rapportage|stats|cijfers|statistieken)/i.test(lower)) {
    return { action: "get_stats", params: {}, message: "Statistieken ophalen..." };
  }

  if (/^(open todo|todo'?s|welke todo|taken|open taken)/i.test(lower)) {
    return { action: "get_open_todos", params: {}, message: "Open to-do's ophalen..." };
  }

  if (/^(check inbox|update mailbox|check mail|nieuwe mails|inbox checken|mail checken|update inbox)/i.test(lower)) {
    return { action: "check_inbox", params: {}, message: "Email inbox checken..." };
  }

  return { action: "unknown", params: {}, message: "Ik begreep je commando niet. Probeer: 'toon leads', 'status [bedrijf] naar [status]', 'notitie [bedrijf]: [tekst]', 'open todo\\'s', of 'rapportage'." };
}

async function parseWithClaude(command) {
  if (!anthropic) return parseCommand(command);

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: command }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error("Claude API error:", err);
  }

  return parseCommand(command);
}

async function findLeadByName(companyName) {
  const { data } = await supabase
    .from("leads")
    .select("*")
    .ilike("company_name", `%${companyName}%`)
    .limit(1)
    .single();
  return data;
}

export async function POST(request) {
  const { command } = await request.json();

  if (!command) {
    return Response.json({ error: "Geen commando opgegeven" }, { status: 400 });
  }

  const parsed = await parseWithClaude(command);

  try {
    switch (parsed.action) {
      case "list_leads": {
        let query = supabase.from("leads").select("*").order("updated_at", { ascending: false });
        if (parsed.params.status) query = query.eq("status", parsed.params.status);
        if (parsed.params.service_type) query = query.eq("service_type", parsed.params.service_type);
        const { data: leads } = await query;

        return Response.json({
          action: "list_leads",
          result: leads,
          message: `Gevonden: ${leads?.length || 0} leads`,
        });
      }

      case "get_lead_detail": {
        const lead = await findLeadByName(parsed.params.company_name);
        if (!lead) {
          return Response.json({
            action: "get_lead_detail",
            message: `Lead "${parsed.params.company_name}" niet gevonden.`,
          });
        }

        const [quotesRes, notesRes] = await Promise.all([
          supabase.from("quotes").select("*").eq("lead_id", lead.id),
          supabase.from("notes").select("*").eq("lead_id", lead.id),
        ]);

        return Response.json({
          action: "get_lead_detail",
          result: { lead, quotes: quotesRes.data, notes: notesRes.data },
          message: `${lead.company_name} — ${lead.status} — ${lead.contact_person}`,
        });
      }

      case "update_status": {
        const lead = await findLeadByName(parsed.params.company_name);
        if (!lead) {
          return Response.json({
            action: "update_status",
            message: `Lead "${parsed.params.company_name}" niet gevonden.`,
          });
        }

        const { error } = await supabase
          .from("leads")
          .update({
            status: parsed.params.new_status,
            ...(parsed.params.new_status === "gewonnen" ? { won_at: new Date().toISOString() } : {}),
          })
          .eq("id", lead.id);

        if (error) {
          return Response.json({
            action: "update_status",
            message: `Fout: ${error.message}`,
          });
        }

        return Response.json({
          action: "update_status",
          result: { lead_id: lead.id, new_status: parsed.params.new_status },
          message: `Status van ${lead.company_name} gewijzigd naar ${parsed.params.new_status}`,
        });
      }

      case "add_note": {
        const lead = await findLeadByName(parsed.params.company_name);
        if (!lead) {
          return Response.json({
            action: "add_note",
            message: `Lead "${parsed.params.company_name}" niet gevonden.`,
          });
        }

        await supabase.from("notes").insert({
          lead_id: lead.id,
          content: parsed.params.content,
          note_type: parsed.params.note_type || "intern",
          created_by: "Cowork",
        });

        await supabase.from("activities").insert({
          lead_id: lead.id,
          activity_type: "note_added",
          description: `Notitie via Cowork: ${parsed.params.content.substring(0, 50)}...`,
          created_by: "Cowork",
        });

        return Response.json({
          action: "add_note",
          message: `Notitie toegevoegd aan ${lead.company_name}`,
        });
      }

      case "create_quote": {
        const lead = await findLeadByName(parsed.params.company_name);
        if (!lead) {
          return Response.json({
            action: "create_quote",
            message: `Lead "${parsed.params.company_name}" niet gevonden. Maak eerst een lead aan.`,
          });
        }

        const amount = parseFloat(parsed.params.amount);
        if (!amount || amount <= 0) {
          return Response.json({
            action: "create_quote",
            message: `Ongeldig bedrag. Gebruik bijv: "offerte Enablemi 5000 Cowork setup"`,
          });
        }

        // Generate quote number
        const { data: quoteNumber } = await supabase.rpc("generate_quote_number");

        // Create the quote
        const { data: quote, error: quoteError } = await supabase
          .from("quotes")
          .insert({
            lead_id: lead.id,
            quote_number: quoteNumber,
            amount_excl_vat: amount,
            vat_percentage: 21.0,
            description: parsed.params.description || null,
            valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            created_by: "Cowork",
          })
          .select()
          .single();

        if (quoteError) {
          return Response.json({
            action: "create_quote",
            message: `Fout bij aanmaken: ${quoteError.message}`,
          });
        }

        // Log activity
        await supabase.from("activities").insert({
          lead_id: lead.id,
          activity_type: "quote_created",
          description: `Offerte ${quoteNumber} aangemaakt via Cowork (€${amount.toLocaleString("nl-NL")} excl. BTW)`,
          metadata: { quote_id: quote.id, quote_number: quoteNumber, amount },
          created_by: "Cowork",
        });

        const vatAmount = amount * 0.21;
        const inclVat = amount + vatAmount;

        return Response.json({
          action: "create_quote",
          result: quote,
          message: `Offerte ${quoteNumber} aangemaakt voor ${lead.company_name}: €${amount.toLocaleString("nl-NL")} excl. BTW (€${inclVat.toLocaleString("nl-NL")} incl. BTW)`,
        });
      }

      case "get_open_todos": {
        const { data: todos } = await supabase
          .from("notes")
          .select("*, leads(company_name)")
          .eq("note_type", "todo")
          .eq("is_completed", false)
          .order("due_date", { ascending: true, nullsLast: true });

        if (!todos || todos.length === 0) {
          return Response.json({
            action: "get_open_todos",
            message: "Geen open to-do's gevonden!",
          });
        }

        const lines = todos.map((t) => {
          const company = t.leads?.company_name || "Onbekend";
          const dueStr = t.due_date
            ? ` (deadline: ${new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })})`
            : "";
          const overdue = t.due_date && new Date(t.due_date) < new Date() ? " ⚠️" : "";
          return `• ${company}: ${t.content}${dueStr}${overdue}`;
        });

        return Response.json({
          action: "get_open_todos",
          result: todos,
          message: `${todos.length} open to-do's:\n${lines.join("\n")}`,
        });
      }

      case "check_inbox": {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://487crm.vercel.app";
          const cronSecret = process.env.CRON_SECRET;
          const res = await fetch(`${baseUrl}/api/poll-inbox`, {
            headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
          });
          const result = await res.json();

          if (result.success) {
            const count = result.processed || 0;
            if (count === 0) {
              return Response.json({
                action: "check_inbox",
                message: "Inbox gecheckt — geen nieuwe emails gevonden.",
              });
            }
            const leads = result.results?.map((r) => `• ${r.email_subject} (${r.status})`).join("\n") || "";
            return Response.json({
              action: "check_inbox",
              result: result.results,
              message: `${count} nieuwe email(s) verwerkt:\n${leads}`,
            });
          }
          return Response.json({
            action: "check_inbox",
            message: `Inbox check mislukt: ${result.error || "onbekende fout"}`,
          });
        } catch (e) {
          return Response.json({
            action: "check_inbox",
            message: `Fout bij inbox check: ${e.message}`,
          });
        }
      }

      case "get_stats": {
        const { data: leads } = await supabase.from("leads").select("*");
        const active = leads?.filter((l) => !["gewonnen", "verloren"].includes(l.status)) || [];
        const won = leads?.filter((l) => l.status === "gewonnen") || [];
        const lost = leads?.filter((l) => l.status === "verloren") || [];

        const pipelineValue = active.reduce((s, l) => s + (parseFloat(l.estimated_value) || 0), 0);
        const wonValue = won.reduce((s, l) => s + (parseFloat(l.estimated_value) || 0), 0);
        const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

        return Response.json({
          action: "get_stats",
          result: {
            total_leads: leads?.length || 0,
            active_leads: active.length,
            pipeline_value: pipelineValue,
            won_value: wonValue,
            win_rate: winRate,
          },
          message: `Pipeline: €${pipelineValue.toLocaleString("nl-NL")} | Gewonnen: €${wonValue.toLocaleString("nl-NL")} | Win rate: ${winRate}% | ${active.length} actieve leads`,
        });
      }

      case "create_lead": {
        return Response.json({
          action: "create_lead",
          needs_input: true,
          message: `Om ${parsed.params.company_name} aan te maken heb ik nodig: contactpersoon naam, email, en optioneel service type. Gebruik het lead formulier (+ knop) of geef deze info.`,
        });
      }

      default:
        return Response.json({
          action: "unknown",
          message: parsed.message || "Onbekend commando. Probeer: 'toon leads', 'rapportage', 'status [bedrijf] naar [status]'.",
        });
    }
  } catch (err) {
    return Response.json({
      action: "error",
      message: `Er ging iets mis: ${err.message}`,
    }, { status: 500 });
  }
}

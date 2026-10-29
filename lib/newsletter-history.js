import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeEmail } from "@/lib/newsletters";

const BATCH_SIZE = 200;
const PAGE_SIZE = 1000;

// Alle rijen van een query, per pagina: één batch adressen kan meer rijen
// opleveren dan de standaardlimiet van Supabase.
async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Ontvangers die nog niet echt zijn verstuurd tellen niet als ontvangen nieuwsbrief.
const NOT_SENT_STATUSES = new Set(["planned", "synced"]);

// Ontvangen nieuwsbrieven en testmails per e-mailadres, nieuwste eerst.
// Map<email, [{ type, campaign_id, campaign_name, subject, sent_at, status, last_event_at }]>
export async function fetchNewsletterHistory(tenant, emails = []) {
  const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const history = new Map(unique.map((email) => [email, []]));

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const [recipientRows, testRows] = await Promise.all([
      fetchAllRows(() =>
        supabaseAdmin
          .from("newsletter_campaign_recipients")
          .select("id, email, status, last_event_at, created_at, newsletter_campaigns(id, name, subject, sent_at, scheduled_at)")
          .eq("tenant", tenant)
          .in("email", batch)
      ),
      fetchAllRows(() =>
        supabaseAdmin
          .from("newsletter_events")
          .select("id, email, occurred_at, campaign_id, newsletter_campaigns(id, name, subject)")
          .eq("tenant", tenant)
          .eq("event_type", "test_sent")
          .in("email", batch)
      ),
    ]);

    for (const row of recipientRows) {
      if (NOT_SENT_STATUSES.has(row.status)) continue;
      const campaign = row.newsletter_campaigns || {};
      history.get(normalizeEmail(row.email))?.push({
        type: "newsletter",
        campaign_id: campaign.id || null,
        campaign_name: campaign.name || "Verwijderde campagne",
        subject: campaign.subject || null,
        sent_at: campaign.sent_at || campaign.scheduled_at || row.created_at,
        status: row.status,
        last_event_at: row.last_event_at,
      });
    }
    for (const row of testRows) {
      const campaign = row.newsletter_campaigns || {};
      history.get(normalizeEmail(row.email))?.push({
        type: "test",
        campaign_id: campaign.id || row.campaign_id || null,
        campaign_name: campaign.name || "Verwijderde campagne",
        subject: campaign.subject || null,
        sent_at: row.occurred_at,
        status: "test",
        last_event_at: null,
      });
    }
  }

  for (const entries of history.values()) {
    entries.sort((a, b) => String(b.sent_at || "").localeCompare(String(a.sent_at || "")));
  }
  return history;
}

// Korte samenvatting voor lijsten: aantal echte nieuwsbrieven en de laatste.
export function summarizeHistory(entries = []) {
  const newsletters = entries.filter((entry) => entry.type === "newsletter");
  return {
    count: newsletters.length,
    last: newsletters[0] ? { campaign_name: newsletters[0].campaign_name, sent_at: newsletters[0].sent_at } : null,
  };
}

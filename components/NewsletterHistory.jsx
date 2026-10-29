"use client";

const STATUS_LABELS = {
  sent: "Verstuurd",
  delivered: "Afgeleverd",
  opened: "Geopend",
  clicked: "Geklikt",
  bounced: "Bounce",
  complained: "Spamklacht",
  failed: "Mislukt",
  delivery_delayed: "Vertraagd",
  unsubscribed: "Uitgeschreven via deze mail",
  scheduled: "Gepland",
  test: "Testmail",
};

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export function historySummaryText(summary) {
  if (!summary?.count) return "Nog geen nieuwsbrieven";
  const last = summary.last ? `, laatst ${formatDate(summary.last.sent_at)}` : "";
  return `${summary.count} nieuwsbrief${summary.count === 1 ? "" : "ven"}${last}`;
}

// Lijst van ontvangen nieuwsbrieven (en testmails) voor één adres.
export default function NewsletterHistory({ entries }) {
  if (!entries) return <p className="text-xs text-gray-400">Laden...</p>;
  if (!entries.length) return <p className="text-xs text-gray-400">Dit adres heeft nog geen nieuwsbrief ontvangen.</p>;
  return (
    <ul className="space-y-1">
      {entries.map((entry, index) => (
        <li key={`${entry.campaign_id}-${entry.type}-${index}`} className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate">
            <span className="text-gray-400 mr-2">{formatDate(entry.sent_at)}</span>
            <span className={entry.type === "test" ? "text-gray-400" : "text-gray-700"}>{entry.campaign_name}</span>
          </span>
          <span className={`shrink-0 ${["bounced", "complained", "failed"].includes(entry.status) ? "text-red-600" : "text-gray-500"}`}>
            {STATUS_LABELS[entry.status] || entry.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

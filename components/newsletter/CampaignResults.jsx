"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDateTime, scheduledAtLabel } from "@/lib/newsletter-status";

const TILES = [
  { key: "delivered", label: "Afgeleverd" },
  { key: "bounced", label: "Bounces", warn: true },
  { key: "complained", label: "Spamklachten", warn: true },
  { key: "failed", label: "Mislukt of geblokkeerd", warn: true },
  { key: "unsubscribed", label: "Uitgeschreven", warn: true },
];

function percent(count, total) {
  if (!total) return "";
  const value = (count / total) * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

// Resultaat van een campagne die verzonden is of nog verzendt: aantallen uit
// de Resend webhook-events, plus verzend- en batchgegevens.
export default function CampaignResults({ campaign }) {
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    apiFetch(`/api/newsletter/campaigns/${campaign.id}/results`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Resultaat laden mislukt");
        if (!cancelled) setResults(json);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.status, campaign.recipient_count]);

  const total = results?.recipient_count || campaign.recipient_count || 0;

  return (
    <div className="bg-white border border-gray-100 rounded-card p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Resultaat</h2>
        <p className="text-sm text-gray-500">
          {campaign.sent_at
            ? `Verzonden ${formatDateTime(campaign.sent_at)}`
            : campaign.scheduled_at
              ? `${scheduledAtLabel(campaign)}: ${formatDateTime(campaign.scheduled_at)}`
              : ""}
        </p>
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {!results && !error && (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      )}

      {results && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase">Ontvangers</p>
            <p className="text-xl font-bold text-brand-black mt-1">{total}</p>
          </div>
          {TILES.map((tile) => {
            const count = results.counts?.[tile.key] || 0;
            const alert = tile.warn && count > 0;
            return (
              <div key={tile.key} className={`rounded-xl border p-3 ${alert ? "border-red-100 bg-red-50" : "border-gray-100 bg-gray-50"}`}>
                <p className="text-xs font-semibold text-gray-500 uppercase">{tile.label}</p>
                <p className={`text-xl font-bold mt-1 ${alert ? "text-red-600" : "text-brand-black"}`}>
                  {count}
                  <span className="ml-1.5 text-xs font-medium text-gray-400">{percent(count, total)}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      {(campaign.batch_mode === "automatic" || campaign.batch_pause_reason) && (
        <div className="text-sm text-gray-600 space-y-1">
          {campaign.batch_mode === "automatic" && (
            <p>
              Batches: {campaign.batch_current_number || 0}/{campaign.batch_total_count || "?"}
              {campaign.batch_next_run_at && campaign.status !== "sent" ? ` · volgende check ${formatDateTime(campaign.batch_next_run_at)}` : ""}
            </p>
          )}
          {campaign.batch_pause_reason && <p className="text-red-600">{campaign.batch_pause_reason}</p>}
        </div>
      )}
      {results && !results.event_count && (
        <p className="text-xs text-gray-400">Nog geen Resend-events ontvangen; de aantallen vullen zich zodra Resend ze meldt.</p>
      )}
    </div>
  );
}

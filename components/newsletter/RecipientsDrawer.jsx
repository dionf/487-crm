"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { hasSendStarted } from "@/lib/newsletter-status";

const RECIPIENT_STATUS_LABELS = {
  planned: "Gepland",
  sent: "Verstuurd",
  delivered: "Afgeleverd",
  delivery_delayed: "Vertraagd",
  bounced: "Bounce",
  complained: "Spamklacht",
  suppressed: "Geblokkeerd",
  failed: "Mislukt",
  unsubscribed: "Uitgeschreven",
};

function recipientStatusClass(status) {
  if (status === "delivered") return "text-green-700";
  if (["bounced", "complained", "suppressed", "failed", "unsubscribed"].includes(status)) return "text-red-600";
  return "text-gray-500";
}

// Zijpaneel met de ontvangers van een campagne. Voor verzenden: wie de
// doelgroep nu oplevert. Tijdens en na verzenden: wie de mail echt kreeg, met
// de status per adres. Sluit met de knop, Escape of een klik naast het paneel.
export default function RecipientsDrawer({ campaign, onClose }) {
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState("");
  const actual = hasSendStarted(campaign);

  useEffect(() => {
    if (!campaign) return undefined;
    let cancelled = false;
    setRecipients(null);
    setError("");
    apiFetch(`/api/newsletter/campaigns/${campaign.id}/${actual ? "results" : "recipients"}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ontvangers laden mislukt");
        if (!cancelled) setRecipients(json);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [campaign, actual]);

  useEffect(() => {
    if (!campaign) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [campaign, onClose]);

  if (!campaign) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">Ontvangers</h2>
            <p className="text-sm text-gray-500 truncate">{campaign.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-brand-black hover:bg-gray-100" title="Sluiten">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
          {!recipients && !error && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          )}
          {recipients && actual && (
            <>
              <p className="mb-3 text-sm font-medium">
                {recipients.recipients_total} ontvangers
                {recipients.truncated && <span className="ml-2 text-xs font-normal text-gray-400">Eerste {recipients.recipients.length} getoond</span>}
              </p>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full">
                  <tbody>
                    {recipients.recipients.map((recipient) => (
                      <tr key={recipient.email} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-sm font-medium break-all">{recipient.email}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{recipient.company_name || recipient.name || "—"}</td>
                        <td className={`px-3 py-2 text-xs font-semibold whitespace-nowrap ${recipientStatusClass(recipient.status)}`}>
                          {RECIPIENT_STATUS_LABELS[recipient.status] || recipient.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {recipients && !actual && (
            <>
              <div className="mb-3 space-y-0.5">
                <p className="text-sm font-medium">
                  {recipients.count} unieke ontvangers
                  {recipients.limited && recipients.total_count > recipients.count ? ` van ${recipients.total_count}` : ""}
                </p>
                {campaign.batch_mode === "automatic" ? (
                  <p className="text-xs text-gray-500">
                    Automatisch: batches van {campaign.batch_size || 100}, check na {campaign.batch_wait_hours || 4} uur
                  </p>
                ) : recipients.recipient_limit && (
                  <p className="text-xs text-gray-500">Limiet: max. {recipients.recipient_limit} ontvangers</p>
                )}
                {recipients.deduplicated_count > 0 && (
                  <p className="text-xs text-amber-700">
                    {recipients.deduplicated_count} dubbele kandidaatadressen verwijderd
                    {recipients.candidate_count ? ` uit ${recipients.candidate_count} kandidaten` : ""}.
                  </p>
                )}
                {recipients.suppressed_count > 0 && (
                  <p className="text-xs text-red-600">
                    {recipients.suppressed_count} persoonlijk uitgeschreven/geblokkeerde adres(sen) uitgesloten.
                  </p>
                )}
                {recipients.duplicate_address_count > 0 && (
                  <p className="text-xs text-gray-500">{recipients.duplicate_address_count} adres(sen) kwamen meer dan 1 keer voor.</p>
                )}
                {recipients.truncated && <p className="text-xs text-gray-400">Eerste 250 getoond</p>}
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full">
                  <tbody>
                    {recipients.recipients.map((recipient) => (
                      <tr key={recipient.email} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-sm font-medium break-all">{recipient.email}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{recipient.name || "—"}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{recipient.company_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

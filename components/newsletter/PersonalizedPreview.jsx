"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Mail, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";

const SENDABLE_STATUSES = new Set(["draft", "tested", "failed"]);

// Volledige mail per bedrijf, testmail van die versie en definitief verzenden.
export default function PersonalizedPreview({
  campaign,
  data,
  resendReady,
  testEmail,
  setTestEmail,
  accent,
  onCampaignChange,
}) {
  const companies = data?.companies || [];
  const progress = data?.progress || { approved: 0, total: 0, ready: false };
  const [leadId, setLeadId] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const first = data?.companies?.[0];
    if (!leadId && first) setLeadId(first.id);
  }, [data, leadId]);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch(`/api/newsletter/campaigns/${campaign.id}/preview?lead_id=${encodeURIComponent(leadId)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Voorbeeld laden mislukt");
        if (!cancelled) setPreview(json);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // data verandert na bewerken of goedkeuren; dan het voorbeeld verversen.
  }, [campaign.id, leadId, data]);

  async function post(path, body, fallback) {
    const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || fallback);
    return json;
  }

  async function sendTest() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const json = await post("test", { to: testEmail, lead_id: leadId }, "Testmail mislukt");
      onCampaignChange(json.campaign);
      setMessage(`Testmail van de versie voor ${preview?.company_name || "dit bedrijf"} verstuurd naar ${testEmail}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function send() {
    const recipientCount = companies.reduce((sum, company) => sum + company.recipients.length, 0);
    if (!confirm(`"${campaign.name}" nu definitief versturen naar ${recipientCount} ontvangers bij ${companies.length} bedrijven?`)) return;
    setBusy("send");
    setError("");
    setMessage("");
    try {
      const json = await post("send", null, "Verzenden mislukt");
      onCampaignChange(json.campaign);
      setMessage(`Verzonden naar ${json.campaign?.recipient_count || recipientCount} ontvangers`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const sendable = SENDABLE_STATUSES.has(campaign.status);
  const blockers = [];
  if (!progress.ready) blockers.push(`Nog ${progress.total - progress.approved} bedrijf/bedrijven goed te keuren`);
  if (!campaign.test_sent_at) blockers.push("Stuur eerst een testmail (na elke wijziging opnieuw)");
  if (campaign.batch_mode === "automatic") blockers.push("Zet automatische batches uit bij de campagne");
  if (campaign.scheduled_at) blockers.push("Maak de verzendtijd leeg; inplannen kan nog niet");
  if (!resendReady) blockers.push("Resend-instellingen zijn niet compleet");

  return (
    <div className="space-y-4">
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {message && <div className="px-3 py-2 rounded-xl bg-green-50 text-green-700 text-sm">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="space-y-2">
          <select
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.company_name} {company.approval === "approved" ? "✓" : ""}
              </option>
            ))}
          </select>
          {preview && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
              <p><span className="text-gray-500">Onderwerp:</span> <strong>{preview.subject}</strong></p>
              <p className="text-xs text-gray-500 mt-0.5">{preview.preheader}</p>
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            )}
            {preview ? (
              <iframe title="Voorbeeld gepersonaliseerde nieuwsbrief" sandbox="" srcDoc={preview.html} className="w-full h-[640px] bg-white" />
            ) : (
              <div className="h-[320px] flex items-center justify-center text-sm text-gray-400">
                {companies.length ? "Voorbeeld laden..." : "Geen ontvangende bedrijven"}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Testmail</p>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Testmail naar"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={!sendable || busy === "test" || !testEmail || !leadId || !resendReady}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-50"
            >
              {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Test versie van dit bedrijf
            </button>
            <p className="text-xs text-gray-500">De uitschrijflink in een testmail schrijft niemand uit.</p>
            {campaign.test_sent_at && (
              <p className="flex items-center gap-1 text-xs font-semibold text-green-700">
                <CheckCircle className="w-3.5 h-3.5" />
                Test verstuurd
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Verzenden</p>
            {campaign.status === "sent" ? (
              <p className="flex items-center gap-1 text-sm font-semibold text-green-700">
                <CheckCircle className="w-4 h-4" />
                Verzonden naar {campaign.recipient_count} ontvangers
              </p>
            ) : (
              <>
                {blockers.length > 0 && (
                  <ul className="space-y-1">
                    {blockers.map((blocker) => (
                      <li key={blocker} className="text-xs text-brand-orange">• {blocker}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={send}
                  disabled={!sendable || blockers.length > 0 || busy === "send"}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Definitief verzenden
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import CampaignList from "@/components/newsletter/CampaignList";
import PendingSubscriptions from "@/components/newsletter/PendingSubscriptions";
import RecipientsDrawer from "@/components/newsletter/RecipientsDrawer";
import { apiFetch } from "@/lib/api";
import { SOURCE_TYPES, sourceTypeLabel } from "@/lib/newsletter-audience";
import { canMutateCampaign } from "@/lib/newsletter-status";
import { useOrg } from "@/lib/org-context";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Save,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

// Nieuwsbrieven: overzicht van campagnes plus de tabbladen Resend, Segmenten
// en Nog geen nieuwsbrief. Een campagne maken of bewerken gebeurt op een
// eigen scherm (/admin/nieuwsbrieven/nieuw en /admin/nieuwsbrieven/[id]).
export default function NieuwsbrievenPage() {
  const router = useRouter();
  const { organization } = useOrg();
  const [settings, setSettings] = useState(null);
  const [segments, setSegments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [segmentOptions, setSegmentOptions] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [recipientsCampaign, setRecipientsCampaign] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    from_name: "",
    from_email: "",
    reply_to: "",
    resend_api_key: "",
    resend_webhook_secret: "",
  });
  const [segmentForm, setSegmentForm] = useState({ name: "", source_type: "all_marketing", source_value: "" });
  const [activeSection, setActiveSection] = useState("campaigns");
  const [pendingCounts, setPendingCounts] = useState(null);

  // Teller op het tabblad "Nog geen nieuwsbrief".
  useEffect(() => {
    apiFetch("/api/newsletter/pending")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => json && setPendingCounts({ companies: json.company_count, addresses: json.address_count }))
      .catch(() => {});
  }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const accent = organization?.theme?.accent || "#F5A623";
  const availableSourceValues = segmentOptions?.options?.[segmentForm.source_type] || [];
  const closeRecipients = useCallback(() => setRecipientsCampaign(null), []);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCampaigns() {
    const res = await apiFetch("/api/newsletter/campaigns");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Kon campagnes niet laden");
    setCampaigns(json.campaigns || []);
  }

  async function fetchAll() {
    setLoading(true);
    setError("");
    try {
      const [settingsRes, segmentsRes, optionsRes] = await Promise.all([
        apiFetch("/api/newsletter/settings"),
        apiFetch("/api/newsletter/segments"),
        apiFetch("/api/newsletter/segment-options"),
        fetchCampaigns(),
      ]);
      const [settingsJson, segmentsJson, optionsJson] = await Promise.all([
        settingsRes.json(),
        segmentsRes.json(),
        optionsRes.json(),
      ]);
      if (!settingsRes.ok) throw new Error(settingsJson.error || "Kon instellingen niet laden");
      if (!segmentsRes.ok) throw new Error(segmentsJson.error || "Kon segmenten niet laden");
      if (optionsRes.ok) setSegmentOptions(optionsJson);

      setSetupRequired(false);
      setSettings(settingsJson.settings);
      setSegments(segmentsJson.segments || []);
      setSettingsForm({
        from_name: settingsJson.settings?.from_name || organization?.display_name || "",
        from_email: settingsJson.settings?.from_email || "",
        reply_to: settingsJson.settings?.reply_to || settingsJson.settings?.from_email || "",
        resend_api_key: "",
        resend_webhook_secret: "",
      });
    } catch (err) {
      setError(err.message);
      setSetupRequired(/migrations\/016_multi_tenant_newsletters\.sql|Nieuwsbrief-tabellen ontbreken/i.test(err.message));
    } finally {
      setLoading(false);
    }
  }

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(""), 2500);
  }

  async function saveSettings(e) {
    e.preventDefault();
    setBusy("settings");
    setError("");
    try {
      const payload = { ...settingsForm };
      if (!payload.resend_api_key) delete payload.resend_api_key;
      if (!payload.resend_webhook_secret) delete payload.resend_webhook_secret;
      const res = await apiFetch("/api/newsletter/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setSettings(json.settings);
      setSettingsForm((current) => ({ ...current, resend_api_key: "", resend_webhook_secret: "" }));
      flash("Instellingen opgeslagen");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function createSegment(e) {
    e.preventDefault();
    setBusy("segment");
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(segmentForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Segment opslaan mislukt");
      setSegments((current) => [...current, json.segment]);
      setSegmentForm({ name: "", source_type: "all_marketing", source_value: "" });
      flash("Segment toegevoegd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteSegment(segment) {
    if (segment.default_excluded) return;
    if (!confirm(`Segment "${segment.name}" verwijderen?`)) return;
    setBusy(`delete-segment-${segment.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/segments?id=${encodeURIComponent(segment.id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Segment verwijderen mislukt");
      setSegments((current) => current.filter((item) => item.id !== segment.id));
      // De server haalt het segment ook uit open campagnes en zet die terug naar concept.
      await fetchCampaigns();
      flash("Segment verwijderd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteCampaign(campaign) {
    if (!canMutateCampaign(campaign)) return;
    if (!confirm(`Campagne "${campaign.name}" verwijderen?`)) return;
    setBusy(`delete-campaign-${campaign.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Campagne verwijderen mislukt");
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      flash("Campagne verwijderd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Terug
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Nieuwsbrieven</h1>
          <p className="text-sm text-gray-500 mt-0.5">{organization?.display_name}</p>
        </div>
        {activeSection === "campaigns" && !setupRequired && (
          <Link
            href="/admin/nieuwsbrieven/nieuw"
            className="flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            <Plus className="w-4 h-4" />
            Nieuwe campagne
          </Link>
        )}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {setupRequired && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 text-brand-orange text-sm">
          De nieuwsbriefmodule is nog niet klaar in de database. Draai eerst de SQL-migratie en herlaad daarna deze pagina.
        </div>
      )}
      {settings?.api_key_valid === false && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 text-brand-orange text-sm flex items-center justify-between gap-3">
          <span>De opgeslagen Resend API-key kan niet worden gelezen. Plak de API-key opnieuw bij Resend instellingen en sla op.</span>
          <button
            type="button"
            onClick={() => setActiveSection("resend")}
            className="shrink-0 px-3 py-1.5 rounded-pill bg-white border border-amber-200 font-semibold"
          >
            Instellingen openen
          </button>
        </div>
      )}
      {message && <div className="mb-4 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">{message}</div>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-gray-100 bg-white p-1">
            {[
              { id: "campaigns", label: "Campagnes" },
              { id: "resend", label: "Resend" },
              { id: "segments", label: "Segmenten" },
              {
                id: "pending",
                label: `Nog geen nieuwsbrief${pendingCounts ? ` (${pendingCounts.companies + pendingCounts.addresses ? `${pendingCounts.companies} bedrijven · ${pendingCounts.addresses} adressen` : "0"})` : ""}`,
              },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeSection === item.id
                    ? "bg-amber-50 text-brand-orange"
                    : "text-gray-500 hover:text-brand-black"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {activeSection === "campaigns" && (
              <CampaignList
                campaigns={campaigns}
                segments={segments}
                busy={busy}
                onShowRecipients={setRecipientsCampaign}
                onDelete={deleteCampaign}
              />
            )}

            {activeSection === "resend" && (
            <form onSubmit={saveSettings} className="bg-white border border-gray-100 rounded-card p-5 max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Resend instellingen</h2>
              </div>
              <div className="space-y-3">
                {settings?.api_key_valid === false && (
                  <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-brand-orange">
                    De API-key moet opnieuw worden opgeslagen voordat testmails of campagnes kunnen worden verstuurd.
                  </div>
                )}
                <input
                  value={settingsForm.from_name}
                  onChange={(e) => setSettingsForm({ ...settingsForm, from_name: e.target.value })}
                  placeholder="Afzendernaam"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="email"
                  value={settingsForm.from_email}
                  onChange={(e) => setSettingsForm({ ...settingsForm, from_email: e.target.value })}
                  placeholder="Afzender e-mail"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="email"
                  value={settingsForm.reply_to}
                  onChange={(e) => setSettingsForm({ ...settingsForm, reply_to: e.target.value })}
                  placeholder="Reply-to"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={settingsForm.resend_api_key}
                  onChange={(e) => setSettingsForm({ ...settingsForm, resend_api_key: e.target.value })}
                  placeholder={
                    settings?.has_api_key
                      ? settings.api_key_valid === false
                        ? "Resend API-key opnieuw opslaan"
                        : `Resend API-key aanwezig (...${settings.api_key_last4})`
                      : "Resend API-key"
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={settingsForm.resend_webhook_secret}
                  onChange={(e) => setSettingsForm({ ...settingsForm, resend_webhook_secret: e.target.value })}
                  placeholder={
                    settings?.has_webhook_secret
                      ? settings.webhook_secret_valid === false
                        ? "Webhooksecret opnieuw opslaan"
                        : "Webhooksecret aanwezig"
                      : "Resend webhook signing secret"
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <button
                  type="submit"
                  disabled={busy === "settings" || setupRequired}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy === "settings" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Opslaan
                </button>
              </div>
            </form>
            )}

            {activeSection === "pending" && (
              <PendingSubscriptions tenant={organization?.slug} onCountsChange={setPendingCounts} />
            )}

            {activeSection === "segments" && (
            <form onSubmit={createSegment} className="bg-white border border-gray-100 rounded-card p-5 max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Segment toevoegen</h2>
              </div>
              <div className="space-y-3">
                <input
                  value={segmentForm.name}
                  onChange={(e) => setSegmentForm({ ...segmentForm, name: e.target.value })}
                  placeholder="Segmentnaam"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <select
                  value={segmentForm.source_type}
                  onChange={(e) => setSegmentForm({ ...segmentForm, source_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </select>
                {segmentForm.source_type === "recipient_email_in" ? (
                  <textarea
                    value={segmentForm.source_value}
                    onChange={(e) => setSegmentForm({ ...segmentForm, source_value: e.target.value })}
                    placeholder={"Plak e-mailadressen onder elkaar of gescheiden met komma's"}
                    rows={4}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  />
                ) : segmentForm.source_type !== "all_marketing" && (
                  <input
                    value={segmentForm.source_value}
                    onChange={(e) => setSegmentForm({ ...segmentForm, source_value: e.target.value })}
                    placeholder={
                      segmentForm.source_type === "without_marketing_segments"
                        ? "Bijv. factor_30,factor_50"
                        : segmentForm.source_type === "recipient_email_contains"
                          ? "Bijv. bol.com"
                          : segmentForm.source_type === "recent_order_days"
                            ? "Bijv. 14"
                          : "Kies hieronder of typ exact"
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  />
                )}
                {segmentOptions && (
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Aanwezige data ({segmentOptions.total_marketing || 0} marketingcontacten)
                    </p>
                    {segmentForm.source_type === "all_marketing" ? (
                      <p className="text-sm text-gray-500">Dit segment gebruikt alle contacten met nieuwsbrief toestemming.</p>
                    ) : availableSourceValues.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {availableSourceValues.slice(0, 40).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setSegmentForm({ ...segmentForm, source_value: option.value })}
                            className="px-2.5 py-1 rounded-pill text-xs font-semibold bg-white text-gray-700 border border-gray-200 hover:border-brand-amber"
                          >
                            {option.value} <span className="text-gray-400">({option.count})</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Geen waarden gevonden voor dit type.</p>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy === "segment" || setupRequired}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-pill text-sm font-semibold hover:border-brand-amber disabled:opacity-60"
                >
                  {busy === "segment" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Segment toevoegen
                </button>
                {segments.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Aangemaakte segmenten</p>
                    <div className="space-y-1.5 max-h-48 overflow-auto">
                      {segments.map((segment) => (
                        <div key={segment.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{segment.name}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {sourceTypeLabel(segment.source_type)}
                              {segment.source_value ? `: ${segment.source_value}` : ""}
                            </p>
                          </div>
                          {segment.default_excluded ? (
                            <span className="shrink-0 text-[10px] font-bold uppercase text-red-600 bg-red-50 border border-red-100 rounded-pill px-2 py-0.5">
                              vast
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => deleteSegment(segment)}
                              disabled={busy === `delete-segment-${segment.id}`}
                              className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title="Segment verwijderen"
                            >
                              {busy === `delete-segment-${segment.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </form>
            )}
          </div>
        </div>
      )}
      <RecipientsDrawer campaign={recipientsCampaign} onClose={closeRecipients} />
    </AppShell>
  );
}

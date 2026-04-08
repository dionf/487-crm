"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, Trash2, FileText } from "lucide-react";
import { LANGUAGES } from "@/lib/translations/quote";

const BRANCH_KEYS = [
  { key: "scholen", label: "Scholen / onderwijs" },
  { key: "bouw", label: "Bouw / buitenwerk" },
  { key: "horeca", label: "Horeca / evenementen" },
  { key: "zorg", label: "Zorg / kinderopvang" },
  { key: "sport", label: "Sport / recreatie" },
  { key: "overheid", label: "Overheid / gemeenten" },
  { key: "overig", label: "Overig" },
];

export default function HipHotTekstenPage() {
  const router = useRouter();

  const [tab, setTab] = useState("intro"); // intro | voorwaarden | branche
  const [language, setLanguage] = useState("nl");
  const [settings, setSettings] = useState(null);
  const [introHtml, setIntroHtml] = useState("");
  const [termsHtml, setTermsHtml] = useState("");

  const [branchTexts, setBranchTexts] = useState([]);
  const [editingBranch, setEditingBranch] = useState(null); // { branch_key, language, title, body, id? }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [sRes, bRes] = await Promise.all([
        apiFetch("/api/hiphot/settings"),
        apiFetch("/api/hiphot/branch-texts"),
      ]);
      const s = await sRes.json();
      const b = await bRes.json();
      setSettings(s.settings);
      setIntroHtml(s.settings?.intro_html?.[language] || "");
      setTermsHtml(s.settings?.terms_html?.[language] || "");
      setBranchTexts(b.texts || []);
    } catch (e) {
      setError("Kon teksten niet laden");
    } finally {
      setLoading(false);
    }
  }

  // Refresh per-language editor when language changes
  useEffect(() => {
    if (!settings) return;
    setIntroHtml(settings.intro_html?.[language] || "");
    setTermsHtml(settings.terms_html?.[language] || "");
  }, [language, settings]);

  async function saveIntroOrTerms(field, value) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const current = settings?.[field] || {};
      const next = { ...current, [language]: value };
      const r = await apiFetch("/api/hiphot/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Opslaan mislukt");
      }
      const j = await r.json();
      setSettings(j.settings);
      setMessage("Opgeslagen");
      setTimeout(() => setMessage(""), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveBranchText() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = {
        branch_key: editingBranch.branch_key,
        language: editingBranch.language,
        title: editingBranch.title || null,
        body: editingBranch.body || null,
      };
      let r;
      if (editingBranch.id) {
        r = await apiFetch(`/api/hiphot/branch-texts/${editingBranch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        r = await apiFetch("/api/hiphot/branch-texts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Opslaan mislukt");
      }
      setEditingBranch(null);
      await fetchAll();
      setMessage("Opgeslagen");
      setTimeout(() => setMessage(""), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBranchText(id) {
    if (!confirm("Branchetekst verwijderen?")) return;
    await apiFetch(`/api/hiphot/branch-texts/${id}`, { method: "DELETE" });
    fetchAll();
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

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-black flex items-center gap-2">
          <FileText className="w-6 h-6 text-amber-500" />
          Offerte teksten
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Beheer de standaard intro, voorwaarden en brancheteksten die in HipHot offertes verschijnen.
        </p>
      </div>

      {/* Language switcher */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 mr-2">Taal:</span>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => setLanguage(l.code)}
            className={`px-3 py-1 text-xs font-semibold rounded-pill ${
              language === l.code
                ? "bg-amber-100 text-amber-800"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { id: "intro", label: "Intro tekst" },
          { id: "voorwaarden", label: "Voorwaarden" },
          { id: "branche", label: "Brancheteksten" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(message || error) && (
        <div
          className={`mb-4 px-4 py-2 rounded-xl text-sm ${
            error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {error || message}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Laden...</p>
      ) : (
        <>
          {tab === "intro" && (
            <div className="bg-white border border-gray-100 rounded-card p-6">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-gray-700">Intro tekst boven artikelen</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Verschijnt op elke offerte boven de productenlijst (bv. &quot;Waarom wij de zonnekoningen zijn&quot;).
                  HTML toegestaan: &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;br&gt;.
                </p>
              </div>
              <textarea
                value={introHtml}
                onChange={(e) => setIntroHtml(e.target.value)}
                rows={14}
                className="w-full text-sm font-mono px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200"
                placeholder="<p><strong>Waarom wij...</strong></p><p>Onze dispensers...</p>"
              />
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-gray-400">Taal: {LANGUAGES.find((l) => l.code === language)?.label}</span>
                <button
                  onClick={() => saveIntroOrTerms("intro_html", introHtml)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-pill disabled:opacity-40"
                >
                  <Save className="w-4 h-4" />
                  Opslaan
                </button>
              </div>

              {introHtml && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Preview</p>
                  <div
                    className="prose prose-sm max-w-none text-gray-700"
                    dangerouslySetInnerHTML={{ __html: introHtml }}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "voorwaarden" && (
            <div className="bg-white border border-gray-100 rounded-card p-6">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-gray-700">Aankoopvoorwaarden onder offerte</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Verschijnt onderaan elke offerte (bv. &quot;Genoemde prijzen zijn excl. BTW...&quot;).
                </p>
              </div>
              <textarea
                value={termsHtml}
                onChange={(e) => setTermsHtml(e.target.value)}
                rows={10}
                className="w-full text-sm font-mono px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200"
                placeholder="<p>Genoemde prijzen zijn excl. BTW.</p>..."
              />
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-gray-400">Taal: {LANGUAGES.find((l) => l.code === language)?.label}</span>
                <button
                  onClick={() => saveIntroOrTerms("terms_html", termsHtml)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-pill disabled:opacity-40"
                >
                  <Save className="w-4 h-4" />
                  Opslaan
                </button>
              </div>

              {termsHtml && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Preview</p>
                  <div
                    className="prose prose-sm max-w-none text-gray-700"
                    dangerouslySetInnerHTML={{ __html: termsHtml }}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "branche" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500">
                  Optionele branchespecifieke teksten (per branche × per taal). Worden automatisch toegevoegd
                  als de lead industrie matcht.
                </p>
                <button
                  onClick={() =>
                    setEditingBranch({
                      branch_key: BRANCH_KEYS[0].key,
                      language,
                      title: "",
                      body: "",
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-pill"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nieuw
                </button>
              </div>

              {branchTexts.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center bg-white border border-gray-100 rounded-card">
                  Nog geen brancheteksten
                </p>
              ) : (
                <div className="space-y-2">
                  {branchTexts.map((bt) => (
                    <div
                      key={bt.id}
                      className="bg-white border border-gray-100 rounded-card p-4 flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-amber-50 text-amber-700">
                            {bt.branch_key}
                          </span>
                          <span className="text-xs text-gray-400">{bt.language}</span>
                        </div>
                        {bt.title && <p className="text-sm font-medium text-gray-800">{bt.title}</p>}
                        {bt.body && (
                          <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                            {bt.body.replace(/<[^>]+>/g, "").substring(0, 200)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingBranch(bt)}
                          className="px-2 py-1 text-xs font-semibold rounded-pill bg-amber-50 text-amber-700 hover:bg-amber-100"
                        >
                          Bewerken
                        </button>
                        <button
                          onClick={() => deleteBranchText(bt.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Branch text editor modal */}
      {editingBranch && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">
              {editingBranch.id ? "Branchetekst bewerken" : "Nieuwe branchetekst"}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Branche</label>
                  <select
                    value={editingBranch.branch_key}
                    onChange={(e) => setEditingBranch({ ...editingBranch, branch_key: e.target.value })}
                    className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  >
                    {BRANCH_KEYS.map((b) => (
                      <option key={b.key} value={b.key}>{b.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Taal</label>
                  <select
                    value={editingBranch.language}
                    onChange={(e) => setEditingBranch({ ...editingBranch, language: e.target.value })}
                    className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Titel</label>
                <input
                  value={editingBranch.title || ""}
                  onChange={(e) => setEditingBranch({ ...editingBranch, title: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  placeholder="Bv. Waarom wij ideaal zijn voor scholen"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Body (HTML)</label>
                <textarea
                  value={editingBranch.body || ""}
                  onChange={(e) => setEditingBranch({ ...editingBranch, body: e.target.value })}
                  rows={10}
                  className="w-full mt-0.5 px-3 py-2 text-sm font-mono border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  placeholder="<p>Onze dispensers zijn perfect voor...</p>"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditingBranch(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-pill hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={saveBranchText}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-pill disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                Opslaan
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import RichEditor from "@/components/RichEditor";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, Trash2, FileText, Mail, Pencil } from "lucide-react";
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

  const [tab, setTab] = useState("intro"); // intro | voorwaarden | branche | email
  const [language, setLanguage] = useState("nl");
  const [settings, setSettings] = useState(null);
  const [introHtml, setIntroHtml] = useState("");
  const [termsHtml, setTermsHtml] = useState("");

  const [branchTexts, setBranchTexts] = useState([]);
  const [editingBranch, setEditingBranch] = useState(null);

  // Email templates
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);

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
      const [sRes, bRes, eRes] = await Promise.all([
        apiFetch("/api/hiphot/settings"),
        apiFetch("/api/hiphot/branch-texts"),
        apiFetch("/api/email-templates"),
      ]);
      const s = await sRes.json();
      const b = await bRes.json();
      const e = await eRes.json();
      setSettings(s.settings);
      setIntroHtml(s.settings?.intro_html?.[language] || "");
      setTermsHtml(s.settings?.terms_html?.[language] || "");
      setBranchTexts(b.texts || []);
      setEmailTemplates(e.templates || []);
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

  // Email template CRUD
  async function saveEmailTemplate() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = {
        name: editingTemplate.name,
        subject: editingTemplate.subject,
        body_html: editingTemplate.body_html,
        language: editingTemplate.language || "nl",
        sort_order: editingTemplate.sort_order || 0,
      };
      let r;
      if (editingTemplate.id) {
        r = await apiFetch(`/api/email-templates/${editingTemplate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        r = await apiFetch("/api/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Opslaan mislukt");
      }
      setEditingTemplate(null);
      await fetchAll();
      setMessage("Template opgeslagen");
      setTimeout(() => setMessage(""), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmailTemplate(id) {
    if (!confirm("Template verwijderen?")) return;
    await apiFetch(`/api/email-templates/${id}`, { method: "DELETE" });
    fetchAll();
  }

  // Filter email templates by selected language
  const filteredTemplates = emailTemplates.filter((t) => t.language === language);

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
          Beheer de standaard intro, voorwaarden, brancheteksten en e-mailtemplates.
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
          { id: "email", label: "E-mail templates" },
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
                  Verschijnt op elke offerte boven de productenlijst.
                </p>
              </div>
              <RichEditor
                value={introHtml}
                onChange={setIntroHtml}
                placeholder="Waarom wij de zonnekoningen zijn..."
                minHeight="250px"
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
            </div>
          )}

          {tab === "voorwaarden" && (
            <div className="bg-white border border-gray-100 rounded-card p-6">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-gray-700">Aankoopvoorwaarden onder offerte</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Verschijnt onderaan elke offerte.
                </p>
              </div>
              <RichEditor
                value={termsHtml}
                onChange={setTermsHtml}
                placeholder="Genoemde prijzen zijn excl. BTW..."
                minHeight="200px"
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
            </div>
          )}

          {tab === "branche" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500">
                  Optionele branchespecifieke teksten (per branche x per taal). Worden automatisch toegevoegd
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

          {tab === "email" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-gray-500">
                    E-mailtemplates die bij het mailen van offertes geselecteerd kunnen worden.
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Placeholders: {"{{voornaam}}"}, {"{{bedrijf}}"}, {"{{offerte_nummer}}"}, {"{{offerte_link}}"}, {"{{bedrag}}"}, {"{{afzender}}"}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setEditingTemplate({
                      name: "",
                      subject: "",
                      body_html: "",
                      language,
                      sort_order: filteredTemplates.length,
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-pill flex-shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nieuw
                </button>
              </div>

              {filteredTemplates.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center bg-white border border-gray-100 rounded-card">
                  Geen templates voor {LANGUAGES.find((l) => l.code === language)?.label || language}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredTemplates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className="bg-white border border-gray-100 rounded-card p-4 flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Mail className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-sm font-medium text-gray-800">{tmpl.name}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          Onderwerp: {tmpl.subject}
                        </p>
                        <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">
                          {tmpl.body_html.replace(/<[^>]+>/g, "").substring(0, 150)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingTemplate(tmpl)}
                          className="px-2 py-1 text-xs font-semibold rounded-pill bg-purple-50 text-purple-700 hover:bg-purple-100"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteEmailTemplate(tmpl.id)}
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
                <label className="text-xs text-gray-500 mb-1 block">Body</label>
                <RichEditor
                  value={editingBranch.body || ""}
                  onChange={(v) => setEditingBranch({ ...editingBranch, body: v })}
                  placeholder="Onze dispensers zijn perfect voor..."
                  minHeight="180px"
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

      {/* Email template editor modal */}
      {editingTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">
              {editingTemplate.id ? "Template bewerken" : "Nieuw e-mailtemplate"}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Naam *</label>
                  <input
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                    placeholder="Bv. Offerte aanbieden"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Taal</label>
                  <select
                    value={editingTemplate.language}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, language: e.target.value })}
                    className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Onderwerp *</label>
                <input
                  value={editingTemplate.subject}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-amber-500"
                  placeholder="Offerte {{offerte_nummer}} — {{bedrijf}}"
                />
                <p className="text-xs text-gray-400 mt-0.5">
                  Gebruik {"{{voornaam}}"}, {"{{bedrijf}}"}, {"{{offerte_nummer}}"}, {"{{offerte_link}}"}, {"{{bedrag}}"}, {"{{afzender}}"}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">E-mailtekst *</label>
                <RichEditor
                  value={editingTemplate.body_html}
                  onChange={(v) => setEditingTemplate({ ...editingTemplate, body_html: v })}
                  placeholder="Beste {{voornaam}},..."
                  minHeight="250px"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditingTemplate(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-pill hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={saveEmailTemplate}
                disabled={saving || !editingTemplate.name || !editingTemplate.subject || !editingTemplate.body_html}
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

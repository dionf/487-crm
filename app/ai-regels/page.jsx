"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch, isAdminFromSession } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  Sparkles,
  Flag,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Save,
  X,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const FILTER_OPTIONS = [
  { id: "active", label: "Actief" },
  { id: "inactive", label: "Inactief" },
  { id: "all", label: "Alle" },
];

export default function AIRegelsPage() {
  const { tenant, isAdmin } = useOrg();
  const effectiveAdmin = isAdmin || isAdminFromSession();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/ai-lessons?filter=${filter}`);
      const data = await res.json();
      setLessons(data.lessons || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  async function handleToggleActive(lesson) {
    if (!effectiveAdmin) return;
    await apiFetch(`/api/ai-lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !lesson.is_active }),
    });
    fetchLessons();
  }

  async function handleFlag(lesson) {
    const res = await apiFetch(`/api/ai-lessons/${lesson.id}/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Kon niet flaggen");
      return;
    }
    if (data.auto_deactivated) {
      alert(`Regel is nu gedeactiveerd na ${data.flag_count} flags.`);
    }
    fetchLessons();
  }

  async function handleDelete(lesson) {
    if (!effectiveAdmin) return;
    if (!confirm(`Deze regel definitief verwijderen?\n\n"${lesson.lesson}"`)) return;
    await apiFetch(`/api/ai-lessons/${lesson.id}`, { method: "DELETE" });
    fetchLessons();
  }

  async function handlePromote(lesson) {
    if (!effectiveAdmin) return;
    await apiFetch(`/api/ai-lessons/${lesson.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promoted_to_base: !lesson.promoted_to_base }),
    });
    fetchLessons();
  }

  function openEdit(lesson) {
    setEditingId(lesson.id);
    setEditForm({
      lesson: lesson.lesson,
      priority: lesson.priority,
      context_tags: (lesson.context_tags || []).join(", "),
    });
  }

  async function handleSaveEdit() {
    if (!editingId || !editForm) return;
    setSaving(true);
    try {
      await apiFetch(`/api/ai-lessons/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lesson: editForm.lesson.trim(),
          priority: Math.max(1, Math.min(10, Number(editForm.priority) || 5)),
          context_tags: editForm.context_tags
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        }),
      });
      setEditingId(null);
      setEditForm(null);
      fetchLessons();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-brand-black flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-amber" />
            AI offerte-regels
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Geleerd uit handmatige correcties op AI-voorstellen.
            {!effectiveAdmin && " Bewerken vereist admin-rechten."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-pill text-xs font-medium transition-colors ${
                filter === f.id
                  ? "bg-brand-amber text-brand-black"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
        </div>
      ) : lessons.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            Nog geen geleerde regels. Lessen worden automatisch toegevoegd bij het committen van een AI-offerte (met &quot;Leer van mijn correcties&quot; aangevinkt).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lessons.map((lesson) => {
            const isEditing = editingId === lesson.id;
            const isExpanded = expandedId === lesson.id;
            const flaggedOut = !lesson.is_active && lesson.flag_count >= 2;

            return (
              <div
                key={lesson.id}
                className={`bg-white border rounded-2xl p-4 ${
                  lesson.is_active
                    ? lesson.promoted_to_base
                      ? "border-brand-amber/50 bg-amber-50/30"
                      : "border-gray-100"
                    : "border-gray-100 opacity-70"
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editForm.lesson}
                      onChange={(e) => setEditForm({ ...editForm, lesson: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">Priority (1-10)</label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={editForm.priority}
                          onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">Tags (komma-gescheiden)</label>
                        <input
                          type="text"
                          value={editForm.context_tags}
                          onChange={(e) => setEditForm({ ...editForm, context_tags: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => { setEditingId(null); setEditForm(null); }}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-pill border border-gray-200"
                      >
                        Annuleren
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving || !editForm.lesson.trim()}
                        className="px-3 py-1.5 text-xs font-semibold text-brand-black bg-brand-amber hover:bg-brand-amber-hover rounded-pill disabled:opacity-50 flex items-center gap-1"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Opslaan
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-pill ${
                          lesson.priority >= 8 ? "bg-red-100 text-red-700" :
                          lesson.priority >= 5 ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          prio {lesson.priority}
                        </span>
                        {lesson.promoted_to_base && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill bg-purple-100 text-purple-700" title="Opgenomen in basis-prompt">
                            base
                          </span>
                        )}
                        {!lesson.is_active && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill bg-gray-100 text-gray-500">
                            {flaggedOut ? `⚠️ ${lesson.flag_count} flags` : "inactief"}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 leading-relaxed">{lesson.lesson}</p>
                        {lesson.context_tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {lesson.context_tags.map((t) => (
                              <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-pill bg-gray-100 text-gray-600">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                          <span>{new Date(lesson.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}</span>
                          {lesson.created_by && <span>• {lesson.created_by}</span>}
                          {lesson.flag_count > 0 && (
                            <span className="text-red-500">⚑ {lesson.flag_count}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-50 flex-wrap">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : lesson.id)}
                        className="text-[11px] font-medium px-2 py-1 rounded-pill bg-gray-50 text-gray-600 hover:bg-gray-100 flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Herkomst
                      </button>
                      <button
                        onClick={() => handleFlag(lesson)}
                        className="text-[11px] font-medium px-2 py-1 rounded-pill bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                        title="Deze regel klopt niet"
                      >
                        <Flag className="w-3 h-3" />
                        Deze klopt niet
                      </button>
                      {effectiveAdmin && (
                        <>
                          <button
                            onClick={() => openEdit(lesson)}
                            className="text-[11px] font-medium px-2 py-1 rounded-pill bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            Bewerken
                          </button>
                          <button
                            onClick={() => handleToggleActive(lesson)}
                            className={`text-[11px] font-medium px-2 py-1 rounded-pill flex items-center gap-1 ${
                              lesson.is_active
                                ? "bg-gray-50 text-gray-600 hover:bg-gray-100"
                                : "bg-green-50 text-green-600 hover:bg-green-100"
                            }`}
                          >
                            {lesson.is_active ? <X className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                            {lesson.is_active ? "Deactiveer" : "Heractiveer"}
                          </button>
                          <button
                            onClick={() => handlePromote(lesson)}
                            className={`text-[11px] font-medium px-2 py-1 rounded-pill flex items-center gap-1 ${
                              lesson.promoted_to_base
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                            }`}
                            title="Markeer als 'bewezen lesson — hoort in basis-prompt'"
                          >
                            <Sparkles className="w-3 h-3" />
                            {lesson.promoted_to_base ? "Gepromoveerd" : "Promote to base"}
                          </button>
                          <button
                            onClick={() => handleDelete(lesson)}
                            className="text-[11px] font-medium px-2 py-1 rounded-pill bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 flex items-center gap-1 ml-auto"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Expanded herkomst */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-50 space-y-3">
                        {lesson.source_quote_id && (
                          <div className="text-xs text-gray-500">
                            Bron-offerte: <code className="font-mono">{lesson.source_quote_id.slice(0, 8)}...</code>
                          </div>
                        )}
                        {Array.isArray(lesson.chat_log) && lesson.chat_log.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Chat-verloop</p>
                            <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 max-h-60 overflow-y-auto">
                              {lesson.chat_log.map((m, i) => (
                                <div key={i} className="text-xs">
                                  <span className={`font-semibold ${m.from === "ai" ? "text-brand-amber" : "text-gray-700"}`}>
                                    {m.from === "ai" ? "AI:" : "Medewerker:"}
                                  </span>{" "}
                                  <span className="text-gray-600">{m.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {lesson.initial_quote && lesson.final_quote && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-gray-500 font-medium">Diff (initieel → finaal)</summary>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <div>
                                <p className="text-[10px] font-semibold text-gray-500 mb-1">Initieel</p>
                                <pre className="bg-gray-50 rounded-lg p-2 text-[10px] overflow-x-auto max-h-40">
                                  {JSON.stringify(lesson.initial_quote.line_items || [], null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold text-gray-500 mb-1">Finaal</p>
                                <pre className="bg-gray-50 rounded-lg p-2 text-[10px] overflow-x-auto max-h-40">
                                  {JSON.stringify(lesson.final_quote.line_items || [], null, 2)}
                                </pre>
                              </div>
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

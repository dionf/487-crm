"use client";

import { useState } from "react";
import { X, Calendar } from "lucide-react";
import { NOTE_TYPES } from "@/lib/constants";

export default function NoteForm({ open, onClose, leadId, onSaved }) {
  const [form, setForm] = useState({
    content: "",
    note_type: "gesprek",
    due_date: "",
    due_time: "",
  });
  const [loading, setLoading] = useState(false);

  function getCurrentUser() {
    if (typeof window !== "undefined") {
      return localStorage.getItem("crm-user") || "Dion";
    }
    return "Dion";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.content.trim()) return;
    setLoading(true);

    let due_date = null;
    if (form.due_date) {
      const time = form.due_time || "09:00";
      due_date = new Date(`${form.due_date}T${time}:00`).toISOString();
    }

    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          content: form.content,
          note_type: form.note_type,
          due_date,
          created_by: getCurrentUser(),
        }),
      });

      if (res.ok) {
        setForm({ content: "", note_type: "gesprek", due_date: "", due_time: "" });
        onSaved?.();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const isTodo = form.note_type === "todo";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">Notitie toevoegen</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Type
            </label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {NOTE_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setForm({ ...form, note_type: t.id })}
                  className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors ${
                    form.note_type === t.id
                      ? "bg-brand-amber text-brand-black"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {isTodo ? "To-do *" : "Notitie *"}
            </label>
            <textarea
              rows={4}
              required
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none"
              placeholder={isTodo ? "Wat moet er gebeuren..." : "Schrijf je notitie..."}
              autoFocus
            />
          </div>

          {/* Due date/time - shown for todos */}
          {isTodo && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Deadline
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="time"
                  value={form.due_time}
                  onChange={(e) => setForm({ ...form, due_time: e.target.value })}
                  className="w-28 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="09:00"
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Optioneel — laat leeg voor to-do zonder deadline</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={loading || !form.content.trim()}
              className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors disabled:opacity-50"
            >
              {loading ? "Opslaan..." : "Toevoegen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

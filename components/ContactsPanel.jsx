"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  Plus,
  Star,
  Mail,
  Phone,
  Pencil,
  Trash2,
  Save,
  X,
  Megaphone,
  UserCircle,
} from "lucide-react";

export default function ContactsPanel({ leadId, contacts = [], onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "", is_primary: false, marketing_consent: false });

  function resetForm() {
    setForm({ name: "", email: "", phone: "", role: "", is_primary: false, marketing_consent: false });
    setAdding(false);
    setEditingId(null);
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    await apiFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, lead_id: leadId }),
    });
    resetForm();
    onUpdate?.();
  }

  async function handleSaveEdit(id) {
    await apiFetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    resetForm();
    onUpdate?.();
  }

  async function handleDelete(id) {
    await apiFetch(`/api/contacts/${id}`, { method: "DELETE" });
    onUpdate?.();
  }

  async function toggleMarketing(contact) {
    await apiFetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketing_consent: !contact.marketing_consent }),
    });
    onUpdate?.();
  }

  async function setPrimary(contact) {
    await apiFetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_primary: true }),
    });
    onUpdate?.();
  }

  function startEdit(contact) {
    setEditingId(contact.id);
    setForm({
      name: contact.name || "",
      email: contact.email || "",
      phone: contact.phone || "",
      role: contact.role || "",
      is_primary: contact.is_primary || false,
      marketing_consent: contact.marketing_consent || false,
    });
  }

  return (
    <div className="space-y-2">
      {contacts.length === 0 && !adding && (
        <p className="text-sm text-gray-400 text-center py-3">Geen contacten</p>
      )}

      {contacts.map((c) => {
        const isEditing = editingId === c.id;

        if (isEditing) {
          return (
            <div key={c.id} className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Naam *"
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  autoFocus
                />
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="Rol (bijv. Directeur)"
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Email"
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Telefoon"
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.marketing_consent}
                    onChange={(e) => setForm({ ...form, marketing_consent: e.target.checked })}
                    className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                  />
                  Marketing
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSaveEdit(c.id)}
                    className="p-1.5 rounded-lg text-green-600 hover:bg-green-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={resetForm}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={c.id} className="flex items-start gap-2 px-3 py-2 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{c.name}</span>
                {c.is_primary && (
                  <Star className="w-3 h-3 text-brand-orange fill-brand-orange flex-shrink-0" />
                )}
                {c.marketing_consent && (
                  <Megaphone className="w-3 h-3 text-green-500 flex-shrink-0" title="Marketing consent" />
                )}
              </div>
              {c.role && (
                <span className="text-[10px] font-semibold uppercase text-gray-400">{c.role}</span>
              )}
              <div className="flex items-center gap-3 mt-0.5">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-brand-orange hover:underline truncate">
                    <Mail className="w-2.5 h-2.5" />
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-gray-500 hover:underline">
                    <Phone className="w-2.5 h-2.5" />
                    {c.phone}
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {!c.is_primary && (
                <button
                  onClick={() => setPrimary(c)}
                  className="p-1 rounded-lg text-gray-300 hover:text-brand-orange transition-colors"
                  title="Maak primair"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => toggleMarketing(c)}
                className={`p-1 rounded-lg transition-colors ${c.marketing_consent ? "text-green-500 hover:text-gray-400" : "text-gray-300 hover:text-green-500"}`}
                title={c.marketing_consent ? "Marketing uit" : "Marketing aan"}
              >
                <Megaphone className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => startEdit(c)}
                className="p-1 rounded-lg text-gray-300 hover:text-brand-orange transition-colors"
                title="Bewerken"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                className="p-1 rounded-lg text-gray-300 hover:text-red-500 transition-colors"
                title="Verwijderen"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      {/* Add form */}
      {adding ? (
        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Naam *"
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              autoFocus
            />
            <input
              type="text"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="Rol (bijv. Directeur)"
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Telefoon"
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
                  className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                />
                Primair contact
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.marketing_consent}
                  onChange={(e) => setForm({ ...form, marketing_consent: e.target.checked })}
                  className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                />
                Marketing
              </label>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleAdd}
                className="px-3 py-1 rounded-lg bg-brand-amber text-xs font-semibold hover:bg-brand-amber-hover transition-colors"
              >
                Toevoegen
              </button>
              <button
                onClick={resetForm}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Contact toevoegen
        </button>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import NewsletterHistory, { historySummaryText } from "@/components/NewsletterHistory";
import { NEWSLETTER_STATE_LABELS, setEmailNewsletter } from "@/components/newsletter/contactNewsletter";
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

const normalize = (email) => String(email || "").trim().toLowerCase();

export default function ContactsPanel({ leadId, contacts = [], onUpdate }) {
  const { isAdmin } = useOrg();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "", is_primary: false });
  // Nieuwsbriefstatus en historie per adres (alleen voor admins beschikbaar).
  const [newsletter, setNewsletter] = useState(null);
  const [openHistory, setOpenHistory] = useState(null);
  const [newsletterError, setNewsletterError] = useState("");

  const loadNewsletter = useCallback(async () => {
    if (!isAdmin || !leadId) return;
    const res = await apiFetch(`/api/newsletter/history?lead_id=${leadId}`);
    if (res.ok) setNewsletter(await res.json());
  }, [isAdmin, leadId]);

  useEffect(() => {
    loadNewsletter();
  }, [loadNewsletter, contacts]);

  function resetForm() {
    setForm({ name: "", email: "", phone: "", role: "", is_primary: false });
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

  // Megafoon = dit adres ontvangt de nieuwsbrief (adresblokkade aan/uit).
  async function toggleNewsletter(contact, addressOn) {
    if (addressOn && !confirm(`${contact.email} uitschrijven voor de nieuwsbrief?`)) return;
    setNewsletterError("");
    try {
      await setEmailNewsletter(contact.email, !addressOn);
      await loadNewsletter();
    } catch (err) {
      setNewsletterError(err.message);
    }
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
    });
  }

  return (
    <div className="space-y-2">
      {newsletterError && <p className="text-xs text-red-600">{newsletterError}</p>}
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
                <span />
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

        const address = newsletter?.addresses?.[normalize(c.email)];
        const addressOn = address ? !address.newsletter.email_suppressed : false;
        const state = address ? NEWSLETTER_STATE_LABELS[address.newsletter.state] : null;
        return (
          <div key={c.id} className="px-3 py-2 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{c.name}</span>
                {c.is_primary && (
                  <Star className="w-3 h-3 text-brand-orange fill-brand-orange flex-shrink-0" />
                )}
                {state && (
                  <span
                    className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-pill border ${state.className}`}
                    title={address.newsletter.suppression?.reason || state.label}
                  >
                    {state.short}
                  </span>
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
              {address && c.email && (
                <button
                  onClick={() => toggleNewsletter(c, addressOn)}
                  className={`p-1 rounded-lg transition-colors ${addressOn ? "text-green-500 hover:text-gray-400" : "text-gray-300 hover:text-green-500"}`}
                  title={addressOn ? "Dit adres uitschrijven voor de nieuwsbrief" : "Dit adres weer inschrijven"}
                >
                  <Megaphone className="w-3.5 h-3.5" />
                </button>
              )}
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
          {address && (
            <button
              type="button"
              onClick={() => setOpenHistory(openHistory === c.id ? null : c.id)}
              className="mt-1 text-[11px] text-gray-400 hover:text-brand-orange"
            >
              {historySummaryText(address.history)}
            </button>
          )}
          {openHistory === c.id && (
            <div className="mt-1 rounded-lg bg-gray-50 px-2 py-1.5">
              <NewsletterHistory entries={newsletter?.history?.[normalize(c.email)] || []} />
            </div>
          )}
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

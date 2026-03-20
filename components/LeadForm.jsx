"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { SERVICE_TYPES, SOURCES } from "@/lib/constants";

export default function LeadForm({ open, onClose, onSaved, lead }) {
  const isEdit = !!lead;

  const [form, setForm] = useState({
    company_name: "",
    contact_person: "",
    email: "",
    phone: "",
    service_type: "",
    estimated_value: "",
    source: "",
    website_url: "",
    commission_partner_percentage: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill when editing, auto-extract website from email if empty
  useEffect(() => {
    if (lead) {
      const suggestedUrl = !lead.website_url ? extractUrlFromEmail(lead.email) : "";
      setForm({
        company_name: lead.company_name || "",
        contact_person: lead.contact_person || "",
        email: lead.email || "",
        phone: lead.phone || "",
        service_type: lead.service_type || "",
        estimated_value: lead.estimated_value || "",
        source: lead.source || "",
        website_url: lead.website_url || suggestedUrl || "",
        commission_partner_percentage: lead.commission_partner_percentage || "",
      });
    } else {
      setForm({
        company_name: "",
        contact_person: "",
        email: "",
        phone: "",
        service_type: "",
        estimated_value: "",
        source: "",
        website_url: "",
        commission_partner_percentage: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, open]);

  // Personal/free email domains to exclude from URL extraction
  const freeEmailDomains = [
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl",
    "outlook.com", "outlook.nl", "live.com", "live.nl",
    "yahoo.com", "yahoo.nl", "icloud.com", "me.com", "mac.com",
    "msn.com", "ziggo.nl", "kpnmail.nl", "xs4all.nl", "planet.nl",
    "casema.nl", "home.nl", "upcmail.nl", "hetnet.nl",
    "protonmail.com", "proton.me", "aol.com",
  ];

  // Extract website URL from email domain
  function extractUrlFromEmail(email) {
    if (!email || !email.includes("@")) return "";
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || freeEmailDomains.includes(domain)) return "";
    return domain;
  }

  // Normalize URL: add https:// if missing
  function normalizeUrl(url) {
    if (!url) return "";
    url = url.trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) {
      return `https://${url}`;
    }
    return url;
  }

  // Auto-fill website when email changes
  function handleEmailChange(email) {
    const updates = { email };
    // Only auto-fill website if it's currently empty
    if (!form.website_url) {
      const extracted = extractUrlFromEmail(email);
      if (extracted) {
        updates.website_url = extracted;
      }
    }
    setForm({ ...form, ...updates });
  }

  function getCurrentUser() {
    if (typeof window !== "undefined") {
      return localStorage.getItem("crm-user") || "Dion";
    }
    return "Dion";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = {
        ...form,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        website_url: normalizeUrl(form.website_url) || null,
        commission_partner_percentage: form.commission_partner_percentage ? parseFloat(form.commission_partner_percentage) : null,
      };

      const url = isEdit ? `/api/leads/${lead.id}` : "/api/leads";
      const method = isEdit ? "PATCH" : "POST";

      if (!isEdit) {
        payload.created_by = getCurrentUser();
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fout bij opslaan");
      }

      if (!isEdit) {
        setForm({
          company_name: "",
          contact_person: "",
          email: "",
          phone: "",
          service_type: "",
          estimated_value: "",
          source: "",
          website_url: "",
        });
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">{isEdit ? "Lead bewerken" : "Nieuwe Lead"}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Bedrijfsnaam *
            </label>
            <input
              type="text"
              required
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Contactpersoon *
              </label>
              <input
                type="text"
                required
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Telefoon
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Email *
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => handleEmailChange(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Website
            </label>
            <input
              type="text"
              value={form.website_url}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              placeholder="www.voorbeeld.nl"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Service type
              </label>
              <select
                value={form.service_type}
                onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
              >
                <option value="">Selecteer...</option>
                {SERVICE_TYPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Bron
              </label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
              >
                <option value="">Selecteer...</option>
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Geschatte waarde
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.estimated_value}
                onChange={(e) => setForm({ ...form, estimated_value: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Commissie %
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.commission_partner_percentage}
                onChange={(e) => setForm({ ...form, commission_partner_percentage: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                placeholder="0"
              />
            </div>
          </div>

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
              disabled={loading}
              className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors disabled:opacity-50"
            >
              {loading ? "Opslaan..." : isEdit ? "Opslaan" : "Lead aanmaken"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

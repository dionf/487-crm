"use client";

import { useState, useEffect } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { SERVICE_TYPES, SOURCES, INDUSTRIES } from "@/lib/constants";
import { useOrg } from "@/lib/org-context";
import { apiFetch } from "@/lib/api";

export default function LeadForm({ open, onClose, onSaved, lead }) {
  const { tenant } = useOrg();
  const isHipHot = tenant === "hiphot";
  const isEdit = !!lead;

  const emptyForm = {
    company_name: "",
    contact_first_name: "",
    contact_last_name: "",
    contact_function: "",
    email: "",
    phone: "",
    service_type: "",
    industry: "",
    estimated_value: "",
    source: "",
    website_url: "",
    commission_partner_percentage: "",
    // Factuur- en leveradres
    billing_street: "",
    billing_house_number: "",
    billing_postal_code: "",
    billing_city: "",
    billing_country: "NL",
    billing_email: "",
    customer_reference: "",
    delivery_same_as_billing: true,
    delivery_street: "",
    delivery_house_number: "",
    delivery_postal_code: "",
    delivery_city: "",
    delivery_country: "NL",
  };

  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddresses, setShowAddresses] = useState(false);

  // Pre-fill when editing, auto-extract website from email if empty
  useEffect(() => {
    if (lead) {
      const suggestedUrl = !lead.website_url ? extractUrlFromEmail(lead.email) : "";
      // For first/last name: use new fields, fallback to splitting contact_person
      let firstName = lead.contact_first_name || "";
      let lastName = lead.contact_last_name || "";
      if (!firstName && lead.contact_person) {
        const parts = lead.contact_person.split(" ");
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ") || "";
      }
      setForm({
        ...emptyForm,
        company_name: lead.company_name || "",
        contact_first_name: firstName,
        contact_last_name: lastName,
        contact_function: lead.contact_function || "",
        email: lead.email || "",
        phone: lead.phone || "",
        service_type: lead.service_type || "",
        industry: lead.industry || "",
        estimated_value: lead.estimated_value || "",
        source: lead.source || "",
        website_url: lead.website_url || suggestedUrl || "",
        commission_partner_percentage: lead.commission_partner_percentage || "",
        billing_street: lead.billing_street || "",
        billing_house_number: lead.billing_house_number || "",
        billing_postal_code: lead.billing_postal_code || "",
        billing_city: lead.billing_city || "",
        billing_country: lead.billing_country || "NL",
        billing_email: lead.billing_email || "",
        customer_reference: lead.customer_reference || "",
        delivery_same_as_billing: lead.delivery_same_as_billing !== false,
        delivery_street: lead.delivery_street || "",
        delivery_house_number: lead.delivery_house_number || "",
        delivery_postal_code: lead.delivery_postal_code || "",
        delivery_city: lead.delivery_city || "",
        delivery_country: lead.delivery_country || "NL",
      });
      // Klap open als er al adres-data is
      if (lead.billing_street || lead.billing_city || lead.customer_reference) {
        setShowAddresses(true);
      }
    } else {
      setForm(emptyForm);
      setShowAddresses(false);
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
        // Sync contact_person for backward compatibility
        contact_person: `${form.contact_first_name} ${form.contact_last_name}`.trim(),
        contact_function: form.contact_function || null,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        website_url: normalizeUrl(form.website_url) || null,
        commission_partner_percentage: form.commission_partner_percentage ? parseFloat(form.commission_partner_percentage) : null,
      };

      const url = isEdit ? `/api/leads/${lead.id}` : "/api/leads";
      const method = isEdit ? "PATCH" : "POST";

      if (!isEdit) {
        payload.created_by = getCurrentUser();
      }

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fout bij opslaan");
      }

      if (!isEdit) {
        setForm(emptyForm);
        setShowAddresses(false);
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
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-lg">{isEdit ? "Lead bewerken" : "Nieuwe Lead"}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
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
                Voornaam *
              </label>
              <input
                type="text"
                required
                value={form.contact_first_name}
                onChange={(e) => setForm({ ...form, contact_first_name: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Achternaam *
              </label>
              <input
                type="text"
                required
                value={form.contact_last_name}
                onChange={(e) => setForm({ ...form, contact_last_name: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Functie
              </label>
              <input
                type="text"
                value={form.contact_function}
                onChange={(e) => setForm({ ...form, contact_function: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                placeholder="bijv. Eigenaar, Directeur"
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
                Branche
              </label>
              <select
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
              >
                <option value="">Selecteer...</option>
                {INDUSTRIES.map((s) => (
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

          {!isHipHot && (
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
          )}

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

          {/* Adressen & facturatie (uitklapbaar) */}
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setShowAddresses(!showAddresses)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-brand-black"
            >
              {showAddresses ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Adressen &amp; facturatie
            </button>

            {showAddresses && (
              <div className="mt-3 space-y-4">
                {/* Klantreferentie + factuur-email */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Klantreferentie
                    </label>
                    <input
                      type="text"
                      value={form.customer_reference}
                      onChange={(e) => setForm({ ...form, customer_reference: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="bijv. PO nummer"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Factuur-e-mail
                    </label>
                    <input
                      type="email"
                      value={form.billing_email}
                      onChange={(e) => setForm({ ...form, billing_email: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="facturen@..."
                    />
                  </div>
                </div>

                {/* Factuuradres */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">Factuuradres</p>
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={form.billing_street}
                          onChange={(e) => setForm({ ...form, billing_street: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                          placeholder="Straat"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          value={form.billing_house_number}
                          onChange={(e) => setForm({ ...form, billing_house_number: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                          placeholder="Nr."
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input
                          type="text"
                          value={form.billing_postal_code}
                          onChange={(e) => setForm({ ...form, billing_postal_code: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                          placeholder="Postcode"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={form.billing_city}
                          onChange={(e) => setForm({ ...form, billing_city: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                          placeholder="Plaats"
                        />
                      </div>
                    </div>
                    <select
                      value={form.billing_country}
                      onChange={(e) => setForm({ ...form, billing_country: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
                    >
                      <option value="NL">Nederland</option>
                      <option value="BE">België</option>
                      <option value="DE">Duitsland</option>
                      <option value="FR">Frankrijk</option>
                      <option value="LU">Luxemburg</option>
                    </select>
                  </div>
                </div>

                {/* Same-as toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.delivery_same_as_billing}
                    onChange={(e) => setForm({ ...form, delivery_same_as_billing: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Leveradres is hetzelfde als factuuradres</span>
                </label>

                {/* Leveradres (alleen als checkbox uit) */}
                {!form.delivery_same_as_billing && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">Leveradres</p>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <input
                            type="text"
                            value={form.delivery_street}
                            onChange={(e) => setForm({ ...form, delivery_street: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                            placeholder="Straat"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            value={form.delivery_house_number}
                            onChange={(e) => setForm({ ...form, delivery_house_number: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                            placeholder="Nr."
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input
                            type="text"
                            value={form.delivery_postal_code}
                            onChange={(e) => setForm({ ...form, delivery_postal_code: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                            placeholder="Postcode"
                          />
                        </div>
                        <div className="col-span-2">
                          <input
                            type="text"
                            value={form.delivery_city}
                            onChange={(e) => setForm({ ...form, delivery_city: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                            placeholder="Plaats"
                          />
                        </div>
                      </div>
                      <select
                        value={form.delivery_country}
                        onChange={(e) => setForm({ ...form, delivery_country: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
                      >
                        <option value="NL">Nederland</option>
                        <option value="BE">België</option>
                        <option value="DE">Duitsland</option>
                        <option value="FR">Frankrijk</option>
                        <option value="LU">Luxemburg</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
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

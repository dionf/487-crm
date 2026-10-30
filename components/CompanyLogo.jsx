"use client";

import { useRef, useState } from "react";
import { Building2, Globe, Loader2, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";

// Logo van een bedrijf: tonen, uploaden, van de website halen of weghalen.
// Gebruikt in de nieuwsbrief (herkenning bij de personalisatie) en straks offertes.
export default function CompanyLogo({ leadId, logoUrl, websiteUrl, onChange, size = "md", editable = true }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const box = size === "sm" ? "h-9 min-w-9 max-w-28" : "h-14 min-w-14 max-w-40";

  async function run(key, init) {
    setBusy(key);
    setError("");
    setOpen(false);
    try {
      const res = await apiFetch(`/api/leads/${leadId}/logo`, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Logo opslaan mislukt");
      onChange?.(json.lead?.logo_url || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function upload(file) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    run("upload", { method: "POST", body: form });
  }

  const fromWebsite = () =>
    run("website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "website" }) });
  const remove = () => run("remove", { method: "DELETE" });

  return (
    <div className="relative inline-flex flex-col items-start">
      <button
        type="button"
        onClick={() => editable && setOpen((value) => !value)}
        disabled={!editable || Boolean(busy)}
        title={logoUrl ? "Logo wijzigen" : "Logo toevoegen"}
        className={`${box} flex items-center justify-center rounded-xl border bg-white px-2 ${
          logoUrl ? "border-gray-100" : "border-dashed border-gray-300 text-gray-400 hover:border-brand-amber hover:text-brand-orange"
        } ${editable ? "cursor-pointer" : "cursor-default"}`}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="max-h-[80%] max-w-full object-contain" />
        ) : (
          <span className="flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap">
            <Building2 className="w-3.5 h-3.5" />
            {size === "sm" ? "Logo" : "Logo toevoegen"}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-50">
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
            <Upload className="w-4 h-4 text-gray-400" />
            Uploaden
          </button>
          <button
            type="button"
            onClick={fromWebsite}
            disabled={!websiteUrl}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 disabled:opacity-40"
            title={websiteUrl ? "" : "Vul eerst een website in"}
          >
            <Globe className="w-4 h-4 text-gray-400" />
            Van de website halen
          </button>
          {logoUrl && (
            <button type="button" onClick={remove} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
              Weghalen
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="text-xs text-red-600 mt-1 max-w-56">{error}</p>}
    </div>
  );
}

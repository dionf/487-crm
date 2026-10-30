"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal normal-case text-brand-black focus:outline-none focus:border-brand-amber";

// Afbeelding voor de nieuwsbrief: uploaden of een URL plakken. Een geplakte
// URL wordt naar de eigen opslag gekopieerd, zodat de mail niet afhangt van
// een andere server.
export default function ImageField({ value, onChange, placeholder = "Plak een afbeelding-URL of upload" }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(init) {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/media", { method: "POST", ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Afbeelding opslaan mislukt");
      onChange(json.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function upload(file) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    send({ body: form });
  }

  function importUrl(url) {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed) || trimmed.includes("/storage/v1/object/public/media/")) return;
    send({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: trimmed }) });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => importUrl(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold normal-case text-brand-black hover:border-brand-amber disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          Upload
        </button>
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
      </div>
      {value && /^https?:\/\//i.test(value) && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-24 rounded-xl border border-gray-100 object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-600"
            aria-label="Afbeelding weghalen"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 normal-case font-normal">{error}</p>}
    </div>
  );
}

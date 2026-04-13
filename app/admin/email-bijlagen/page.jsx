"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { ArrowLeft, Upload, Trash2, FileText, Loader2 } from "lucide-react";
import Link from "next/link";

export default function EmailBijlagenPage() {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    fetchAttachments();
  }, []);

  async function fetchAttachments() {
    try {
      const res = await apiFetch("/api/email-attachments");
      const data = await res.json();
      setAttachments(data.attachments || []);
    } catch {
      setError("Kon bijlagen niet laden");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) {
      setError("Vul een naam in en selecteer een bestand");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim());

      const res = await apiFetch("/api/email-attachments", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setName("");
      fileRef.current.value = "";
      await fetchAttachments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id, attName) {
    if (!confirm(`"${attName}" verwijderen?`)) return;

    try {
      const res = await apiFetch("/api/email-attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchAttachments();
    } catch (err) {
      setError(err.message);
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto py-8 px-4">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Terug
        </Link>

        <h1 className="text-xl font-bold mb-1">E-mail bijlagen beheren</h1>
        <p className="text-sm text-gray-500 mb-6">
          Standaard bijlagen die medewerkers kunnen meesturen bij offerte-emails (folders, prijslijsten, etc.)
        </p>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl mb-4">
            {error}
          </div>
        )}

        {/* Upload form */}
        <div className="bg-white border border-gray-100 rounded-card p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Nieuwe bijlage uploaden</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Weergavenaam *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                placeholder="Bijv. Productfolder 2025, Prijslijst dispensers..."
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Bestand *
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                className="w-full mt-1 text-sm file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              />
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-40"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {uploading ? "Bezig met uploaden..." : "Uploaden"}
            </button>
          </div>
        </div>

        {/* Existing attachments */}
        <div className="bg-white border border-gray-100 rounded-card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Huidige bijlagen ({attachments.length})
          </h2>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Laden...
            </div>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">
              Nog geen bijlagen. Upload een PDF om te beginnen.
            </p>
          ) : (
            <div className="space-y-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl border border-gray-100 hover:bg-gray-50"
                >
                  <FileText className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {att.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {att.file_name} &middot; {formatFileSize(att.file_size)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(att.id, att.name)}
                    className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Verwijderen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

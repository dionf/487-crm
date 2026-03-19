"use client";

import { useState, useRef } from "react";
import {
  Paperclip,
  Upload,
  FileText,
  Image,
  File,
  Trash2,
  Download,
  Loader2,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

const FILE_ICONS = {
  "application/pdf": FileText,
  "image/png": Image,
  "image/jpeg": Image,
  "image/webp": Image,
  default: File,
};

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentUpload({
  leadId,
  quoteId,
  attachments = [],
  onUploaded,
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function getCurrentUser() {
    if (typeof window !== "undefined") {
      return localStorage.getItem("crm-user") || "Dion";
    }
    return "Dion";
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("lead_id", leadId);
        if (quoteId) formData.append("quote_id", quoteId);
        formData.append("uploaded_by", getCurrentUser());

        await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });
      }
      onUploaded?.();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleFileSelect(e) {
    handleUpload(Array.from(e.target.files));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(Array.from(e.dataTransfer.files));
  }

  async function handleDownload(attachmentId, fileName) {
    try {
      const res = await fetch(`/api/attachments/${attachmentId}`);
      const data = await res.json();
      if (data.download_url) {
        window.open(data.download_url, "_blank");
      }
    } catch {}
  }

  async function handleDelete(attachmentId) {
    try {
      await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
      onUploaded?.();
    } catch {}
  }

  const relevantAttachments = quoteId
    ? attachments.filter((a) => a.quote_id === quoteId)
    : attachments;

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-brand-amber bg-brand-amber/5"
            : "border-gray-200 hover:border-brand-amber/50"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.xls,.txt,.csv"
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <Loader2 className="w-5 h-5 animate-spin text-brand-amber" />
            <span className="text-sm text-gray-500">Uploaden...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-2">
            <Upload className="w-5 h-5 text-gray-400" />
            <span className="text-xs text-gray-500">
              Sleep bestanden hierheen of klik om te uploaden
            </span>
            <span className="text-[10px] text-gray-400">
              PDF, afbeeldingen, Word, Excel (max 50MB)
            </span>
          </div>
        )}
      </div>

      {/* Attachment list */}
      {relevantAttachments.length > 0 && (
        <div className="space-y-1.5">
          {relevantAttachments.map((att) => {
            const Icon = FILE_ICONS[att.file_type] || FILE_ICONS.default;

            return (
              <div
                key={att.id}
                className="flex items-center gap-2.5 px-3 py-2 bg-brand-light-gray rounded-xl group"
              >
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {att.file_name}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {formatFileSize(att.file_size)} &middot;{" "}
                    {formatRelativeTime(att.created_at)}
                    {att.uploaded_by && ` door ${att.uploaded_by}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(att.id, att.file_name);
                    }}
                    className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-brand-orange transition-colors"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(att.id);
                    }}
                    className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-red-500 transition-colors"
                    title="Verwijderen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

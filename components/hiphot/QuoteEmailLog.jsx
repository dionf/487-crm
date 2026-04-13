"use client";

import { useState, useEffect } from "react";
import { Mail, ChevronDown, ChevronRight, Clock, CheckCircle, AlertCircle, Paperclip } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_ICONS = {
  sent: { icon: CheckCircle, color: "text-green-500", label: "Verzonden" },
  delivered: { icon: CheckCircle, color: "text-green-600", label: "Bezorgd" },
  opened: { icon: Mail, color: "text-blue-500", label: "Geopend" },
  bounced: { icon: AlertCircle, color: "text-red-500", label: "Bounced" },
};

export default function QuoteEmailLog({ leadId }) {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [attachments, setAttachments] = useState({}); // { email_id: [...] }

  useEffect(() => {
    if (!leadId) return;
    apiFetch(`/api/hiphot/emails?lead_id=${leadId}`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.emails || [];
        setEmails(list);
        // Fetch attachments for all emails
        if (list.length) {
          apiFetch(`/api/hiphot/email-attachments?email_ids=${list.map((e) => e.id).join(",")}`)
            .then((r) => r.json())
            .then((a) => {
              const byEmail = {};
              for (const att of a.attachments || []) {
                if (!byEmail[att.email_id]) byEmail[att.email_id] = [];
                byEmail[att.email_id].push(att);
              }
              setAttachments(byEmail);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [leadId]);

  if (loading) return null;
  if (emails.length === 0) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-card p-5">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
        <Mail className="w-3.5 h-3.5" />
        Verzonden e-mails ({emails.length})
      </h3>
      <div className="space-y-2">
        {emails.map((email) => {
          const statusInfo = STATUS_ICONS[email.status] || STATUS_ICONS.sent;
          const StatusIcon = statusInfo.icon;
          const isExpanded = expanded === email.id;

          return (
            <div key={email.id} className="border border-gray-100 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : email.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
              >
                <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusInfo.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{email.subject}</p>
                  <p className="text-xs text-gray-500">
                    Naar {email.to_email} · {formatRelativeTime(email.sent_at)}
                    {email.sent_by && ` · door ${email.sent_by}`}
                  </p>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-100">
                  <div
                    className="mt-2 p-3 bg-gray-50 rounded-lg text-sm prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: email.body_html }}
                  />
                  {attachments[email.id]?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {attachments[email.id].map((att) => (
                        <span
                          key={att.id}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-lg text-xs text-gray-600"
                        >
                          <Paperclip className="w-3 h-3" />
                          {att.attachment_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

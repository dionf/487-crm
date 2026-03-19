"use client";

import { formatDateTime } from "@/lib/utils";
import {
  ArrowRight,
  FileText,
  MessageSquare,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";

const ACTIVITY_ICONS = {
  status_change: ArrowRight,
  quote_created: FileText,
  note_added: MessageSquare,
  lead_created: Plus,
  quote_sent: FileText,
  quote_accepted: CheckCircle,
  quote_rejected: XCircle,
};

const ACTIVITY_COLORS = {
  status_change: "bg-blue-100 text-blue-600",
  quote_created: "bg-amber-100 text-amber-600",
  note_added: "bg-purple-100 text-purple-600",
  lead_created: "bg-green-100 text-green-600",
  quote_sent: "bg-amber-100 text-amber-600",
  quote_accepted: "bg-green-100 text-green-600",
  quote_rejected: "bg-red-100 text-red-600",
};

export default function ActivityTimeline({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        Nog geen activiteiten
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.activity_type] || Clock;
        const colors =
          ACTIVITY_COLORS[activity.activity_type] || "bg-gray-100 text-gray-600";

        return (
          <div key={activity.id} className="flex items-start gap-3">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colors}`}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-brand-dark-gray">
                {activity.description}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400">
                  {formatDateTime(activity.created_at)}
                </span>
                {activity.created_by && (
                  <span className="text-xs text-gray-400">
                    door {activity.created_by}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

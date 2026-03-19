import { STATUS_COLORS, LEAD_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";

export default function StatusBadge({ status, size = "sm" }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.nieuw;
  const label = LEAD_STATUSES.find((s) => s.id === status)?.label || status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold rounded-pill",
        colors.bg,
        colors.text,
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", colors.dot)} />
      {label}
    </span>
  );
}

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import { nl } from "date-fns/locale";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date) {
  if (!date) return "";
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: nl });
}

export function formatDate(date) {
  if (!date) return "";
  return format(new Date(date), "d MMM yyyy", { locale: nl });
}

export function formatDateTime(date) {
  if (!date) return "";
  return format(new Date(date), "d MMM yyyy HH:mm", { locale: nl });
}

export function formatCurrency(amount) {
  if (amount == null) return "-";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

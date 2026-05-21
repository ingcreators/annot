// Tiny formatters shared across screens.

import { getLocale, t } from "./i18n.js";
import type { ApplicationCategory, ApplicationStatus, User } from "./state.js";

export function formatCategory(category: ApplicationCategory | ""): string {
  if (category === "") {
    return "";
  }
  return t(`form.category.${category}`);
}

export function formatStatus(status: ApplicationStatus): string {
  return t(`status.${status}`);
}

export function formatAmount(amount: number, category: ApplicationCategory): string {
  if (category === "leave") {
    return "—";
  }
  const locale = getLocale();
  try {
    return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `¥${amount.toLocaleString()}`;
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return new Intl.DateTimeFormat(getLocale() === "ja" ? "ja-JP" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

export function displayName(user: User | undefined): string {
  if (!user) {
    return "";
  }
  return user.displayName[getLocale()];
}

import { config } from "../config.js";

/** ₦2,400,000 — the way the skill is told to write amounts. */
export function naira(amountNgn: number): string {
  return `₦${Math.round(amountNgn).toLocaleString("en-NG")}`;
}

/** Paystack takes kobo. ₦2,400,000 → 240000000. */
export function toKobo(amountNgn: number): number {
  return Math.round(amountNgn * 100);
}

export function fromKobo(amountKobo: number): number {
  return Math.round(amountKobo) / 100;
}

/**
 * "2026-10-20 14:05" in Lagos time. The ledger is read by a human owner in
 * Lagos, so local time beats ISO/UTC in the sheet.
 */
export function lagosTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.business.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** "2026-10-20" in Lagos time. */
export function lagosDate(date = new Date()): string {
  return lagosTimestamp(date).slice(0, 10);
}

/**
 * Account codes are typed by hand on a phone keyboard, so "kg ada",
 * "KG-ADA" and "kgada" must all mean the same account. Compare on letters
 * and digits only.
 */
export function normaliseAccountCode(input: string): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** PINs arrive as "4461" or "4 4 6 1". Keep the digits. */
export function normalisePin(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Normalise a phone number to E.164 Nigeria (+234...). Phones are contact
 * details for Kola now, not identity — Chord never tells us who is calling.
 */
export function normalisePhone(input: string): string {
  const digits = (input ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits === "") return "";
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  // A bare 10-digit local number, e.g. 8020000001
  if (digits.length === 10) return `+234${digits}`;
  return `+${digits}`;
}

export function samePhone(a: string, b: string): boolean {
  return normalisePhone(a) === normalisePhone(b);
}

export function formatDate(timestamp: unknown): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "0分钟";
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

export function formatRating(value: unknown): string {
  const rating = normalizeBookRating(value);
  return rating === undefined ? "-" : rating.toFixed(1);
}

export function normalizeBookRating(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  // The live gateway currently returns 0-1000 values (for example, 830 = 8.3),
  // while older payloads used 0-100 values. Keep the compact contract on 0-10.
  return value > 100 ? value / 100 : value / 10;
}

export function formatStars(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  const count = Math.max(1, Math.min(5, Math.round(value / 20)));
  return "*".repeat(count);
}

export function truncate(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

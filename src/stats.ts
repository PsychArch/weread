type UnknownRecord = Record<string, unknown>;

export interface StatsSummary {
  mode: string;
  baseTime?: number;
  totalReadTime?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  readDays?: number;
  dayAverageReadTime?: number;
  compare?: number;
  comparison?: StatsComparison;
  preferTimeWord?: string;
  preferCategoryWord?: string;
  readTimes: Record<string, number>;
  readStat: StatsCountSummary[];
  topBooks: StatsBookSummary[];
  categories: StatsCategorySummary[];
  authors: StatsAuthorSummary[];
  dataQuality: StatsDataQuality;
}

export interface StatsCountSummary {
  label: string;
  value: string;
}

export type StatsBucketGranularity = "day" | "month" | "year";

export interface StatsTimeBucket {
  startDate: string;
  seconds: number;
}

export interface StatsTrendPeriod extends Omit<StatsSummary, "readTimes" | "readStat"> {
  bucketGranularity: StatsBucketGranularity;
  buckets: StatsTimeBucket[];
  counts: StatsCountSummary[];
}

export interface StatsComparison {
  ratio: number;
  percent: number;
  direction: "up" | "down" | "unchanged";
  basis: "natural-day-average";
}

export interface StatsDataQuality {
  unidentifiedRankedItems: number;
  durationBreakdownMatchesTotal?: boolean;
}

export const STATS_FIELD_GUIDE = {
  durationUnit: "seconds",
  totalReadTime: "Authoritative reading/listening total for the requested period.",
  dayAverageReadTime: "Natural-calendar-day average, including days with no reading; not the average per active reading day.",
  compare: "Ratio change in natural-day average versus the previous equivalent period; 0.2 means up 20%.",
  counts: "Period event summaries from WeRead; read and finished counts are not a cohort completion rate.",
  buckets: "Bucket size depends on mode: day for weekly/monthly, month for annually, year for overall.",
  durationBreakdown: "Use totalReadTime when wrReadTime plus wrListenTime does not match it.",
  topBooks: "WeRead returns at most 10 ranked items; unidentified upstream items are omitted and reported in dataQuality/warnings.",
} as const;

export interface StatsBookSummary {
  title: string;
  author: string;
  readTime?: number;
  tags: string[];
}

export interface StatsCategorySummary {
  title: string;
  count?: number;
  readTime?: number;
}

export interface StatsAuthorSummary {
  name: string;
  count?: number;
  readTime?: string;
}

export function summarizeStats(result: unknown, mode: string): StatsSummary {
  const record = asRecord(result);
  const totalReadTime = finiteNumber(record.totalReadTime);
  const wrReadTime = finiteNumber(record.wrReadTime);
  const wrListenTime = finiteNumber(record.wrListenTime);
  const compare = finiteNumber(record.compare);
  const ranked = summarizeLongest(record.readLongest);
  const durationBreakdownMatchesTotal = totalReadTime !== undefined
    && wrReadTime !== undefined
    && wrListenTime !== undefined
    ? totalReadTime === wrReadTime + wrListenTime
    : undefined;
  return {
    mode,
    ...optionalNumber("baseTime", record.baseTime),
    ...(totalReadTime !== undefined ? { totalReadTime } : {}),
    ...(wrReadTime !== undefined ? { wrReadTime } : {}),
    ...(wrListenTime !== undefined ? { wrListenTime } : {}),
    ...optionalNumber("readDays", record.readDays),
    ...optionalNumber("dayAverageReadTime", record.dayAverageReadTime),
    ...(compare !== undefined ? {
      compare,
      comparison: {
        ratio: compare,
        percent: compare * 100,
        direction: compare > 0 ? "up" : compare < 0 ? "down" : "unchanged",
        basis: "natural-day-average",
      } satisfies StatsComparison,
    } : {}),
    ...optionalString("preferTimeWord", record.preferTimeWord),
    ...optionalString("preferCategoryWord", record.preferCategoryWord),
    readTimes: normalizeReadTimes(record.readTimes),
    readStat: summarizeReadStat(record.readStat),
    topBooks: ranked.items,
    categories: summarizeCategories(record.preferCategory),
    authors: summarizeAuthors(record.preferAuthor),
    dataQuality: {
      unidentifiedRankedItems: ranked.unidentified,
      ...(durationBreakdownMatchesTotal !== undefined ? { durationBreakdownMatchesTotal } : {}),
    },
  };
}

export function summarizeTrendPeriod(result: unknown, mode: string): StatsTrendPeriod {
  const summary = summarizeStats(result, mode);
  const { readTimes, readStat, ...rest } = summary;
  return {
    ...rest,
    bucketGranularity: bucketGranularity(mode),
    buckets: Object.entries(readTimes)
      .map(([timestamp, seconds]) => ({
        startDate: shanghaiDate(Number(timestamp)),
        seconds,
      }))
      .filter((entry) => entry.startDate !== "")
      .sort((left, right) => left.startDate.localeCompare(right.startDate)),
    counts: readStat,
  };
}

export function statsWarnings(periods: StatsTrendPeriod[]): string[] {
  const warnings: string[] = [];
  for (const period of periods) {
    if (period.dataQuality.unidentifiedRankedItems > 0) {
      warnings.push(
        `${period.mode}: omitted ${period.dataQuality.unidentifiedRankedItems} ranked item(s) whose upstream title and author were empty.`,
      );
    }
    if (period.dataQuality.durationBreakdownMatchesTotal === false) {
      warnings.push(
        `${period.mode}: wrReadTime + wrListenTime does not match totalReadTime; use totalReadTime as authoritative.`,
      );
    }
  }
  return warnings;
}

export function parsePeriodDate(value: string): number {
  const normalized = /^\d{4}$/.test(value)
    ? `${value}-01-01`
    : /^\d{4}-\d{2}$/.test(value)
      ? `${value}-01`
      : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Expected YYYY, YYYY-MM, or YYYY-MM-DD, got ${value}`);
  }
  const date = new Date(`${normalized}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime()) || shanghaiDate(date.getTime()) !== normalized) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return Math.floor(date.getTime() / 1000);
}

function normalizeReadTimes(value: unknown): Record<string, number> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => (
      /^\d+$/.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1])
    )),
  );
}

function summarizeReadStat(value: unknown): StatsCountSummary[] {
  return asArray(value).map((entry) => {
    const item = asRecord(entry);
    return {
      label: text(item.stat) || text(item.label) || text(item.name),
      value: text(item.counts) || text(item.value) || String(item.count ?? ""),
    };
  }).filter((entry) => entry.label || entry.value);
}

function shanghaiDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(milliseconds));
}

function summarizeLongest(value: unknown): { items: StatsBookSummary[]; unidentified: number } {
  let unidentified = 0;
  const items = asArray(value).slice(0, 10).flatMap((entry) => {
    const item = asRecord(entry);
    const book = asRecord(item.book);
    const album = asRecord(item.albumInfo);
    const title = text(book.title) || text(album.name) || text(album.title);
    const author = text(book.author) || text(album.authorName) || text(album.author);
    if (!title && !author) {
      unidentified += 1;
      return [];
    }
    return [{
      title,
      author,
      ...optionalNumber("readTime", item.readTime),
      tags: asArray(item.tags).map(text).filter(Boolean),
    }];
  });
  return { items, unidentified };
}

function bucketGranularity(mode: string): StatsBucketGranularity {
  if (mode === "annually") return "month";
  if (mode === "overall") return "year";
  return "day";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeCategories(value: unknown): StatsCategorySummary[] {
  return asArray(value).slice(0, 10).map((entry) => {
    const item = asRecord(entry);
    return {
      title: text(item.categoryTitle),
      ...optionalNumber("count", item.readingCount),
      ...optionalNumber("readTime", item.readingTime),
    };
  });
}

function summarizeAuthors(value: unknown): StatsAuthorSummary[] {
  return asArray(value).slice(0, 8).map((entry) => {
    const item = asRecord(entry);
    return {
      name: text(item.name),
      ...optionalNumber("count", item.count),
      ...optionalString("readTime", item.readTime),
    };
  });
}

function optionalNumber<Key extends string>(key: Key, value: unknown): { [K in Key]?: number } {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as { [K in Key]?: number } : {};
}

function optionalString<Key extends string>(key: Key, value: unknown): { [K in Key]?: string } {
  return typeof value === "string" ? { [key]: value } as { [K in Key]?: string } : {};
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

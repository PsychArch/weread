type UnknownRecord = Record<string, unknown>;

export const STATS_HISTORY_MIN_YEAR = 2017;

export interface StatsSummary {
  mode: string;
  baseTime?: number;
  totalReadTime?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  readDays?: number;
  dayAverageReadTime?: number;
  compare?: number;
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
  numericValue: number | null;
  unit: string | null;
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

export interface StatsHistoryPeriod extends StatsTrendPeriod {
  year: number;
  startDate: string;
  endDate: string;
  throughDate: string;
  periodComplete: boolean;
  elapsedDays: number;
}

export interface StatsDataQuality {
  unidentifiedRankedItems: number;
  durationBreakdown: {
    status: "unavailable" | "matches" | "mismatch";
    deltaSeconds: number | null;
  };
}

export interface StatsHistoryRange {
  earliestSupportedYear: number;
  firstNonzeroYear: number | null;
  lastCompleteYear: number;
  currentYear: number;
  source: "stats.trend.overall.buckets";
}

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
  const durationDelta = totalReadTime !== undefined
    && wrReadTime !== undefined
    && wrListenTime !== undefined
    ? wrReadTime + wrListenTime - totalReadTime
    : undefined;
  return {
    mode,
    ...optionalNumber("baseTime", record.baseTime),
    ...(totalReadTime !== undefined ? { totalReadTime } : {}),
    ...(wrReadTime !== undefined ? { wrReadTime } : {}),
    ...(wrListenTime !== undefined ? { wrListenTime } : {}),
    ...optionalNumber("readDays", record.readDays),
    ...optionalNumber("dayAverageReadTime", record.dayAverageReadTime),
    ...(compare !== undefined ? { compare } : {}),
    ...optionalString("preferTimeWord", record.preferTimeWord),
    ...optionalString("preferCategoryWord", record.preferCategoryWord),
    readTimes: normalizeReadTimes(record.readTimes),
    readStat: summarizeReadStat(record.readStat),
    topBooks: ranked.items,
    categories: summarizeCategories(record.preferCategory),
    authors: summarizeAuthors(record.preferAuthor),
    dataQuality: {
      unidentifiedRankedItems: ranked.unidentified,
      durationBreakdown: durationDelta === undefined
        ? { status: "unavailable", deltaSeconds: null }
        : {
            status: durationDelta === 0 ? "matches" : "mismatch",
            deltaSeconds: durationDelta,
          },
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
    const year = "year" in period && typeof period.year === "number" ? period.year : undefined;
    const context = year === undefined ? period.mode : `${period.mode} ${year}`;
    if (period.dataQuality.unidentifiedRankedItems > 0) {
      warnings.push(
        `${context}: omitted ${period.dataQuality.unidentifiedRankedItems} ranked item(s) whose upstream title and author were empty.`,
      );
    }
    if (period.dataQuality.durationBreakdown.status === "mismatch") {
      warnings.push(
        `${context}: wrReadTime + wrListenTime differs from totalReadTime by ${period.dataQuality.durationBreakdown.deltaSeconds} second(s).`,
      );
    }
  }
  return warnings;
}

export function statsHistoryRange(periods: StatsTrendPeriod[], currentYear: number): StatsHistoryRange {
  const overall = periods.find((period) => period.mode === "overall");
  const years = (overall?.buckets ?? [])
    .filter((bucket) => bucket.seconds > 0)
    .map((bucket) => Number(bucket.startDate.slice(0, 4)))
    .filter((year) => Number.isInteger(year));
  return {
    earliestSupportedYear: STATS_HISTORY_MIN_YEAR,
    firstNonzeroYear: years.length ? Math.min(...years) : null,
    lastCompleteYear: currentYear - 1,
    currentYear,
    source: "stats.trend.overall.buckets",
  };
}

export function annotateHistoryPeriods(
  periods: Array<StatsTrendPeriod & { year: number }>,
  asOfDate: string,
): StatsHistoryPeriod[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error(`Expected an Asia/Shanghai as-of date in YYYY-MM-DD form, got ${asOfDate}`);
  }
  const asOfYear = Number(asOfDate.slice(0, 4));
  return periods.map((period) => {
    if (period.year > asOfYear) {
      throw new Error(`History period ${period.year} is later than the as-of year ${asOfYear}`);
    }
    const startDate = `${period.year}-01-01`;
    const endDate = `${period.year}-12-31`;
    const periodComplete = period.year < asOfYear;
    const throughDate = periodComplete ? endDate : asOfDate;
    const elapsedDays = inclusiveCalendarDays(startDate, throughDate);
    return {
      ...period,
      startDate,
      endDate,
      throughDate,
      periodComplete,
      elapsedDays,
    };
  });
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
    const value = text(item.counts) || text(item.value) || String(item.count ?? "");
    const parsed = parseCountValue(value);
    return {
      label: text(item.stat) || text(item.label) || text(item.name),
      value,
      numericValue: parsed.numericValue,
      unit: parsed.unit,
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
  const items = asArray(value).flatMap((entry) => {
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

function inclusiveCalendarDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function parseCountValue(value: string): { numericValue: number | null; unit: string | null } {
  const match = value.trim().match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(.*)$/);
  if (!match) return { numericValue: null, unit: null };
  const numericValue = Number(match[1]!.replaceAll(",", ""));
  return {
    numericValue: Number.isFinite(numericValue) ? numericValue : null,
    unit: match[2] || null,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeCategories(value: unknown): StatsCategorySummary[] {
  return asArray(value).map((entry) => {
    const item = asRecord(entry);
    return {
      title: text(item.categoryTitle),
      ...optionalNumber("count", item.readingCount),
      ...optionalNumber("readTime", item.readingTime),
    };
  });
}

function summarizeAuthors(value: unknown): StatsAuthorSummary[] {
  return asArray(value).map((entry) => {
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

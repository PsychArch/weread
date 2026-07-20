import { describe, expect, it } from "vitest";
import { annotateHistoryPeriods, parsePeriodDate, statsHistoryRange, statsWarnings, summarizeStats, summarizeTrendPeriod } from "../src/stats.js";

describe("stats summaries", () => {
  it("keeps trend fields while removing bulky book metadata", () => {
    const readTimes = { "1780243200": 1534, "1780329600": 3174 };
    const summary = summarizeStats({
      baseTime: 1780243200,
      totalReadTime: 4708,
      readDays: 2,
      dayAverageReadTime: 2354,
      compare: 0.25,
      preferTimeWord: "偏好上午与夜晚阅读",
      preferCategoryWord: "偏好阅读科学技术",
      readTimes,
      readStat: [{ stat: "读过", counts: "2本" }],
      readLongest: [{
        book: {
          title: "基因传",
          author: "悉达多·穆克吉",
          intro: "very long intro",
          cover: "https://example.test/cover.jpg",
          centPrice: 2599,
          lastChapterIdx: 48,
        },
        readTime: 23843,
        tags: ["笔记最多", "单日阅读最久"],
      }],
      preferCategory: [{ categoryTitle: "科学技术", readingCount: 1, readingTime: 23843 }],
      preferAuthor: [{ name: "悉达多·穆克吉", count: 1, readTime: "6小时37分钟" }],
    }, "monthly");

    expect(summary).toEqual({
      mode: "monthly",
      baseTime: 1780243200,
      totalReadTime: 4708,
      readDays: 2,
      dayAverageReadTime: 2354,
      compare: 0.25,
      preferTimeWord: "偏好上午与夜晚阅读",
      preferCategoryWord: "偏好阅读科学技术",
      readTimes,
      readStat: [{ label: "读过", value: "2本", numericValue: 2, unit: "本" }],
      topBooks: [{
        title: "基因传",
        author: "悉达多·穆克吉",
        readTime: 23843,
        tags: ["笔记最多", "单日阅读最久"],
      }],
      categories: [{ title: "科学技术", count: 1, readTime: 23843 }],
      authors: [{ name: "悉达多·穆克吉", count: 1, readTime: "6小时37分钟" }],
      dataQuality: {
        unidentifiedRankedItems: 0,
        durationBreakdown: { status: "unavailable", deltaSeconds: null },
      },
    });
    expect(JSON.stringify(summary)).not.toContain("very long intro");
    expect(JSON.stringify(summary)).not.toContain("cover.jpg");
  });

  it("normalizes timestamps to Asia/Shanghai calendar dates", () => {
    const period = summarizeTrendPeriod({
      readTimes: { "0": 3, "1780243200": 120 },
      readStat: [{ stat: "读过", counts: "1本" }],
    }, "weekly");

    expect(period.bucketGranularity).toBe("day");
    expect(period.buckets).toEqual([{ startDate: "2026-06-01", seconds: 120 }]);
    expect(period.counts).toEqual([{ label: "读过", value: "1本", numericValue: 1, unit: "本" }]);
  });

  it("summarizes album entries and tolerates missing optional fields", () => {
    const summary = summarizeStats({
      readLongest: [{
        albumInfo: { name: "Some Album", authorName: "Narrator" },
        tags: ["听书"],
      }],
    }, "overall");

    expect(summary).toEqual({
      mode: "overall",
      readTimes: {},
      readStat: [],
      topBooks: [{ title: "Some Album", author: "Narrator", tags: ["听书"] }],
      categories: [],
      authors: [],
      dataQuality: {
        unidentifiedRankedItems: 0,
        durationBreakdown: { status: "unavailable", deltaSeconds: null },
      },
    });
  });

  it("omits unidentified ranked items and warns on inconsistent duration breakdowns", () => {
    const period = summarizeTrendPeriod({
      totalReadTime: 100,
      wrReadTime: 90,
      wrListenTime: 30,
      readLongest: [
        { albumInfo: {}, readTime: 60 },
        { book: { title: "Known", author: "Author" }, readTime: 40 },
      ],
    }, "annually");

    expect(period.topBooks).toEqual([{ title: "Known", author: "Author", readTime: 40, tags: [] }]);
    expect(period.bucketGranularity).toBe("month");
    expect(period.dataQuality).toEqual({
      unidentifiedRankedItems: 1,
      durationBreakdown: { status: "mismatch", deltaSeconds: 20 },
    });
    expect(statsWarnings([period])).toEqual([
      "annually: omitted 1 ranked item(s) whose upstream title and author were empty.",
      "annually: wrReadTime + wrListenTime differs from totalReadTime by 20 second(s).",
    ]);
  });

  it("accepts human period dates in Asia/Shanghai", () => {
    expect(parsePeriodDate("2026")).toBe(1767196800);
    expect(parsePeriodDate("2026-07")).toBe(1782835200);
    expect(() => parsePeriodDate("2026-02-30")).toThrow("Invalid calendar date");
  });

  it("derives explicit history bounds from the returned overall buckets", () => {
    const overall = summarizeTrendPeriod({
      readTimes: {
        "1514736000": 0,
        "1546272000": 0,
        "1577808000": 42,
        "1609430400": 100,
      },
    }, "overall");

    expect(statsHistoryRange([overall], 2026)).toEqual({
      earliestSupportedYear: 2017,
      firstNonzeroYear: 2020,
      lastCompleteYear: 2025,
      currentYear: 2026,
      source: "stats.trend.overall.buckets",
    });
  });

  it("adds calendar coverage facts without analytical ratios", () => {
    const periods = annotateHistoryPeriods([
      {
        year: 2023,
        ...summarizeTrendPeriod({ totalReadTime: 3600, readDays: 1 }, "annually"),
      },
      {
        year: 2024,
        ...summarizeTrendPeriod({ totalReadTime: 7200, readDays: 2 }, "annually"),
      },
    ], "2025-07-20");

    expect(periods[0]).toMatchObject({
      startDate: "2023-01-01",
      endDate: "2023-12-31",
      throughDate: "2023-12-31",
      periodComplete: true,
      elapsedDays: 365,
    });
    expect(periods[0]).not.toHaveProperty("derivedMetrics");
    expect(periods[1]).not.toHaveProperty("derivedMetrics");
  });

  it("marks the current annual period partial and uses elapsed calendar days", () => {
    const [period] = annotateHistoryPeriods([{
      year: 2026,
      ...summarizeTrendPeriod({ totalReadTime: 7200, readDays: 148 }, "annually"),
    }], "2026-07-20");

    expect(period).toMatchObject({
      throughDate: "2026-07-20",
      periodComplete: false,
      elapsedDays: 201,
    });
    expect(period).not.toHaveProperty("derivedMetrics");
  });
});

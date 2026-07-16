import { describe, expect, it } from "vitest";
import { parsePeriodDate, statsWarnings, summarizeStats, summarizeTrendPeriod } from "../src/stats.js";

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
      comparison: {
        ratio: 0.25,
        percent: 25,
        direction: "up",
        basis: "natural-day-average",
      },
      preferTimeWord: "偏好上午与夜晚阅读",
      preferCategoryWord: "偏好阅读科学技术",
      readTimes,
      readStat: [{ label: "读过", value: "2本" }],
      topBooks: [{
        title: "基因传",
        author: "悉达多·穆克吉",
        readTime: 23843,
        tags: ["笔记最多", "单日阅读最久"],
      }],
      categories: [{ title: "科学技术", count: 1, readTime: 23843 }],
      authors: [{ name: "悉达多·穆克吉", count: 1, readTime: "6小时37分钟" }],
      dataQuality: { unidentifiedRankedItems: 0 },
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
    expect(period.counts).toEqual([{ label: "读过", value: "1本" }]);
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
      dataQuality: { unidentifiedRankedItems: 0 },
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
      durationBreakdownMatchesTotal: false,
    });
    expect(statsWarnings([period])).toEqual([
      "annually: omitted 1 ranked item(s) whose upstream title and author were empty.",
      "annually: wrReadTime + wrListenTime does not match totalReadTime; use totalReadTime as authoritative.",
    ]);
  });

  it("accepts human period dates in Asia/Shanghai", () => {
    expect(parsePeriodDate("2026")).toBe(1767196800);
    expect(parsePeriodDate("2026-07")).toBe(1782835200);
    expect(() => parsePeriodDate("2026-02-30")).toThrow("Invalid calendar date");
  });
});

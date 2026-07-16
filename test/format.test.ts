import { describe, expect, it } from "vitest";
import { formatDuration, formatRating } from "../src/format.js";

describe("formatting", () => {
  it("treats reading durations as seconds", () => {
    expect(formatDuration(3660)).toBe("1小时1分钟");
  });

  it("treats WeRead ratings as 0-100 values", () => {
    expect(formatRating(93)).toBe("9.3");
  });

  it("normalizes the live gateway's 0-1000 book ratings", () => {
    expect(formatRating(830)).toBe("8.3");
  });
});

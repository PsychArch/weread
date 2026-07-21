import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { CORPUS_CURSOR_PATTERN, decodeCorpusCursor, encodeCorpusCursor } from "../src/corpus-cursor.js";

describe("notes corpus cursor", () => {
  const state = {
    lastSort: 30,
    lastBookId: "1234",
    emitted: 10,
    totalBookCount: 276,
  };

  it("round-trips one canonical versioned token", () => {
    const token = encodeCorpusCursor(state);
    expect(token).toMatch(new RegExp(CORPUS_CURSOR_PATTERN));
    expect(decodeCorpusCursor(token)).toEqual(state);
    expect(encodeCorpusCursor(decodeCorpusCursor(token))).toBe(token);
  });

  it("rejects malformed, noncanonical, and unsupported tokens", () => {
    const reorderedJson = JSON.stringify({
      emitted: 10,
      lastBookId: "1234",
      lastSort: 30,
      totalBookCount: 276,
    });
    const reordered = `wrc1.${Buffer.from(reorderedJson).toString("base64url")}`;
    const extra = `wrc1.${Buffer.from(JSON.stringify({ ...state, extra: true })).toString("base64url")}`;

    for (const token of [
      "",
      "wrc2.payload",
      "wrc1.not-canonical!",
      `${encodeCorpusCursor(state)}=`,
      reordered,
      extra,
    ]) {
      expect(() => decodeCorpusCursor(token), token).toThrow(/restart without --cursor/);
    }
  });

  it("rejects unsafe or non-advancing state", () => {
    expect(() => encodeCorpusCursor({ ...state, emitted: 0 })).toThrow(/restart without --cursor/);
    expect(() => encodeCorpusCursor({ ...state, totalBookCount: 9 })).toThrow(/restart without --cursor/);
    expect(() => encodeCorpusCursor({ ...state, lastSort: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/restart without --cursor/);
    expect(() => encodeCorpusCursor({ ...state, lastBookId: "two ids" })).toThrow(/restart without --cursor/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/errors.js";
import { jsonSuccess, printError, printResult, setMetadataProvider } from "../src/output.js";

afterEach(() => vi.restoreAllMocks());

describe("structured output", () => {
  it("wraps stable JSON data in a versioned success envelope", () => {
    expect(jsonSuccess({ count: 2 }, { gatewaySkillVersion: "1.0.6" })).toEqual({
      ok: true,
      data: { count: 2 },
      meta: {
        schemaVersion: "3",
        gatewaySkillVersion: "1.0.6",
        complete: true,
        timeZone: "Asia/Shanghai",
      },
      warnings: [],
    });
  });

  it("pins the envelope gateway version onto top-level and batch continuations", () => {
    const result = jsonSuccess({
      page: {
        hasMore: true,
        nextArgs: { "--last-sort": 10 },
        nextArgv: ["--json", "notes", "notebooks", "--last-sort", "10"],
      },
      batches: [{
        page: {
          hasMore: true,
          nextArgs: { "--max-idx": 2, "--synckey": 3 },
          nextArgv: [
            "--json", "reviews", "batch", "--book-id", "1", "--max-idx", "2", "--synckey", "3",
          ],
        },
      }],
    }, { gatewaySkillVersion: "1.0.9" });

    expect(result.data).toMatchObject({
      page: {
        nextArgv: [
          "--json", "notes", "notebooks", "--last-sort", "10", "--skill-version", "1.0.9",
        ],
      },
      batches: [{
        page: {
          nextArgv: [
            "--json", "reviews", "batch", "--book-id", "1", "--max-idx", "2", "--synckey", "3",
            "--skill-version", "1.0.9",
          ],
        },
      }],
    });
  });

  it("writes success JSON only to stdout and errors only to stderr", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    printResult({ json: true }, { count: 1 }, () => "human");
    expect(log).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { count: 1 } });

    printError({ json: true }, new CliError("TEST_ERROR", "failed"));
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { code: "TEST_ERROR", message: "failed" },
      meta: { complete: false },
    });
  });

  it("keeps --agent byte-compatible with --json and leaves --raw unwrapped", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    printResult({ json: true }, { count: 1 }, () => "human");
    printResult({ agent: true }, { count: 1 }, () => "human");
    printResult({ raw: true }, { count: 1 }, () => "human");

    expect(log.mock.calls[0]?.[0]).toBe(log.mock.calls[1]?.[0]);
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toEqual({ count: 1 });
  });

  it("merges client and command warnings without duplicates", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    setMetadataProvider(() => ({ warnings: ["client warning", "shared"] }));

    printResult(
      { json: true },
      { count: 1 },
      () => "human",
      { warnings: ["shared", "command warning"] },
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0])).warnings).toEqual([
      "client warning",
      "shared",
      "command warning",
    ]);
    setMetadataProvider(() => ({}));
  });
});

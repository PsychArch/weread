import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/errors.js";
import { agentSuccess, printError, printResult, setAgentMetadataProvider } from "../src/output.js";

afterEach(() => vi.restoreAllMocks());

describe("agent output", () => {
  it("wraps compact data in a versioned success envelope", () => {
    expect(agentSuccess({ count: 2 }, { gatewaySkillVersion: "1.0.6", complete: false })).toEqual({
      ok: true,
      data: { count: 2 },
      meta: {
        schemaVersion: "2",
        gatewaySkillVersion: "1.0.6",
        complete: false,
        timeZone: "Asia/Shanghai",
      },
      warnings: [],
    });
  });

  it("writes success JSON only to stdout and errors only to stderr", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    printResult({ agent: true }, { count: 1 }, () => "human");
    expect(log).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { count: 1 } });

    printError({ agent: true }, new CliError("TEST_ERROR", "failed"));
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { code: "TEST_ERROR", message: "failed" },
      meta: { complete: false },
    });
  });

  it("merges client and command warnings without duplicates", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    setAgentMetadataProvider(() => ({ warnings: ["client warning", "shared"] }));

    printResult(
      { agent: true },
      { count: 1 },
      () => "human",
      { warnings: ["shared", "command warning"] },
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0])).warnings).toEqual([
      "client warning",
      "shared",
      "command warning",
    ]);
    setAgentMetadataProvider(() => ({}));
  });
});

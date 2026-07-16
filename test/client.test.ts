import { describe, expect, it, vi } from "vitest";
import { assertGatewayOk, parseParam, WereadClient } from "../src/client.js";
import { CliError } from "../src/errors.js";

describe("WereadClient", () => {
  it("builds flat gateway requests with skill_version", async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const client = new WereadClient({ apiKey: "wrk-test-key", fetchImpl });
    await client.call("/store/search", { keyword: "基因传", count: 5 });

    expect(calls).toEqual([
      {
        api_name: "/store/search",
        keyword: "基因传",
        count: 5,
        skill_version: "1.0.5",
      },
    ]);
  });

  it("does not allow business parameters to override request metadata", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new WereadClient({ apiKey: "wrk-test-key", fetchImpl });

    await client.call("/_list", { api_name: "/store/search", skill_version: "0.0.0" });

    expect(bodies[0]).toMatchObject({ api_name: "/_list", skill_version: "1.0.5" });
  });

  it("negotiates a compatible gateway protocol once", async () => {
    const bodies: Record<string, unknown>[] = [];
    const responses = [
      { upgrade_info: { latest_version: "1.0.6", message: "upgrade" } },
      { ok: true },
    ];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new WereadClient({ apiKey: "wrk-test-key", fetchImpl, retryBaseMs: 0 });
    await client.call("/_list");

    expect(bodies.map((body) => body.skill_version)).toEqual(["1.0.5", "1.0.6"]);
    expect(client.skillVersion).toBe("1.0.6");
    expect(client.getWarnings()).toContain("Gateway protocol negotiated from 1.0.5 to 1.0.6.");
  });

  it("does not negotiate across gateway protocol major versions", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      upgrade_info: { latest_version: "2.0.0", message: "major upgrade" },
    }), { status: 200 })) as unknown as typeof fetch;
    const client = new WereadClient({ apiKey: "wrk-test-key", fetchImpl });

    await expect(client.call("/_list")).rejects.toMatchObject({ code: "UPGRADE_REQUIRED" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries an empty 200 and succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const client = new WereadClient({
      apiKey: "wrk-test-key",
      fetchImpl,
      retryBaseMs: 0,
      sleepImpl: async () => undefined,
    });

    await expect(client.call("/_list")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails clearly after repeated empty responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const client = new WereadClient({
      apiKey: "wrk-test-key",
      fetchImpl,
      maxAttempts: 3,
      sleepImpl: async () => undefined,
    });

    await expect(client.call("/_list")).rejects.toMatchObject({ code: "RESPONSE_EMPTY" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([429, 500, 503])("retries HTTP %s for read calls", async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "retry" }), { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const client = new WereadClient({
      apiKey: "wrk-test-key",
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    await expect(client.call("/_list")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("backs off and retries the gateway's HTTP 499 rate-limit response", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: -2014, errmsg: "请求频率超限" }), { status: 499 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const client = new WereadClient({
      apiKey: "wrk-test-key",
      fetchImpl,
      sleepImpl: async (milliseconds) => { sleeps.push(milliseconds); },
    });

    await expect(client.call("/_list")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2_000]);
    expect(client.getWarnings()).toContain("Gateway request /_list succeeded after 2 attempts.");
  });

  it("retries malformed JSON and reports the final response error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{truncated", { status: 200 })) as unknown as typeof fetch;
    const client = new WereadClient({
      apiKey: "wrk-test-key",
      fetchImpl,
      maxAttempts: 2,
      sleepImpl: async () => undefined,
    });

    await expect(client.call("/_list")).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("turns upgrade_info into a typed error", () => {
    expect(() => assertGatewayOk({ upgrade_info: { message: "upgrade now" } })).toThrow(CliError);
  });

  it("parses raw params as typed values", () => {
    expect(parseParam("scope=10")).toEqual(["scope", 10]);
    expect(parseParam("keyword=基因传")).toEqual(["keyword", "基因传"]);
    expect(parseParam("reviews=[{\"range\":\"1-2\"}]")).toEqual(["reviews", [{ range: "1-2" }]]);
    expect(() => parseParam("api_name=/_list")).toThrow("controlled by the CLI");
  });
});

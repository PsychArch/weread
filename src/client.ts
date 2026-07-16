import { requireApiKey } from "./config.js";
import { CliError } from "./errors.js";

export const GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
export const SKILL_VERSION = "1.0.5";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  skillVersion?: string;
  maxAttempts?: number;
  retryBaseMs?: number;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

export class WereadClient {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly sleepImpl: (milliseconds: number) => Promise<void>;
  private readonly warnings: string[] = [];
  private currentSkillVersion: string;

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.currentSkillVersion = options.skillVersion ?? (process.env.WEREAD_SKILL_VERSION?.trim() || SKILL_VERSION);
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.sleepImpl = options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new CliError("CONFIG_INVALID", "maxAttempts must be a positive integer.");
    }
  }

  get skillVersion(): string {
    return this.currentSkillVersion;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  async call<T = unknown>(apiName: string, params: JsonObject = {}): Promise<T> {
    if (!/^\/[A-Za-z0-9_/-]+$/.test(apiName)) {
      throw new CliError("ARG_INVALID", `Invalid gateway API name: ${apiName}`);
    }
    const apiKey = this.apiKey ?? (await requireApiKey());
    let reliabilityAttempt = 0;
    let versionRetryUsed = false;

    while (reliabilityAttempt < this.maxAttempts) {
      reliabilityAttempt += 1;
      const requestSkillVersion = this.currentSkillVersion;
      let response: Response;
      try {
        response = await this.fetchImpl(GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...params,
            api_name: apiName,
            skill_version: requestSkillVersion,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (reliabilityAttempt < this.maxAttempts) {
          await this.retryDelay(reliabilityAttempt);
          continue;
        }
        throw new CliError(
          "NETWORK_ERROR",
          `Gateway request failed after ${reliabilityAttempt} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const responseText = await response.text();
      if (!responseText.trim()) {
        if (isRetryableStatus(response.status) && reliabilityAttempt < this.maxAttempts) {
          await this.retryDelay(reliabilityAttempt, response);
          continue;
        }
        throw new CliError("RESPONSE_EMPTY", `Gateway returned an empty response (${response.status}).`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        if (reliabilityAttempt < this.maxAttempts) {
          await this.retryDelay(reliabilityAttempt, response);
          continue;
        }
        throw new CliError(
          "RESPONSE_INVALID",
          `Gateway returned malformed JSON (${response.status}) after ${reliabilityAttempt} attempts.`,
        );
      }

      if (!response.ok) {
        const rateLimited = response.status === 429 || isGatewayRateLimit(payload);
        if ((isRetryableHttpStatus(response.status) || rateLimited) && reliabilityAttempt < this.maxAttempts) {
          await this.retryDelay(reliabilityAttempt, response, rateLimited ? 2_000 : 0);
          continue;
        }
        throw new CliError("HTTP_ERROR", `Gateway request failed with HTTP ${response.status}.`, payload);
      }

      try {
        assertGatewayOk(payload);
      } catch (error) {
        if (error instanceof CliError && error.code === "UPGRADE_REQUIRED" && !versionRetryUsed) {
          const latestVersion = upgradeVersion(error.details);
          if (latestVersion && requestSkillVersion !== latestVersion && sameMajorVersion(requestSkillVersion, latestVersion)) {
            if (this.currentSkillVersion !== latestVersion) {
              this.currentSkillVersion = latestVersion;
              this.warnings.push(`Gateway protocol negotiated from ${requestSkillVersion} to ${latestVersion}.`);
            }
            versionRetryUsed = true;
            reliabilityAttempt -= 1;
            continue;
          }
        }
        throw error;
      }

      if (reliabilityAttempt > 1) {
        this.warnings.push(`Gateway request ${apiName} succeeded after ${reliabilityAttempt} attempts.`);
      }
      return payload as T;
    }

    throw new CliError("NETWORK_ERROR", "Gateway request exhausted all retry attempts.");
  }

  private async retryDelay(attempt: number, response?: Response, minimumMs = 0): Promise<void> {
    const retryAfter = response?.headers.get("retry-after");
    const retryAfterMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : 0;
    await this.sleepImpl(Math.max(minimumMs * 2 ** (attempt - 1), retryAfterMs, this.retryBaseMs * 2 ** (attempt - 1)));
  }
}

export function assertGatewayOk(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;

  const record = payload as Record<string, unknown>;
  if (record.upgrade_info && typeof record.upgrade_info === "object") {
    const message = (record.upgrade_info as { message?: unknown }).message;
    throw new CliError(
      "UPGRADE_REQUIRED",
      typeof message === "string" ? message : "WeRead gateway requires a CLI/skill upgrade.",
      record.upgrade_info,
    );
  }

  if (typeof record.errcode === "number" && record.errcode !== 0) {
    const message =
      typeof record.errmsg === "string"
        ? record.errmsg
        : typeof record.message === "string"
          ? record.message
          : `Gateway returned errcode ${record.errcode}.`;
    throw new CliError("API_ERROR", message, payload);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || (status >= 200 && status < 300);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isGatewayRateLimit(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  if (record.errcode === -2014) return true;
  const message = [record.errmsg, record.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /频率|rate\s*limit|too many requests/i.test(message);
}

function upgradeVersion(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const record = details as Record<string, unknown>;
  const value = record.latest_version ?? record.latestVersion;
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
}

function sameMajorVersion(left: string, right: string): boolean {
  return left.split(".")[0] === right.split(".")[0];
}

export function parseParam(input: string): [string, JsonValue] {
  const index = input.indexOf("=");
  if (index <= 0) {
    throw new CliError("ARG_INVALID", `Expected --param key=value, got ${input}`);
  }
  const key = input.slice(0, index).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
    throw new CliError("ARG_INVALID", `Invalid parameter name: ${key || "(empty)"}`);
  }
  if (["api_name", "skill_version"].includes(key)) {
    throw new CliError("ARG_INVALID", `${key} is controlled by the CLI and cannot be overridden.`);
  }
  return [key, parseValue(input.slice(index + 1))];
}

function parseValue(raw: string): JsonValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw) as JsonValue;
    } catch {
      throw new CliError("ARG_INVALID", `Invalid JSON value: ${raw}`);
    }
  }
  return raw;
}

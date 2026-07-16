import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "./errors.js";

export interface WereadConfig {
  apiKey?: string;
}

export type CredentialSource = "environment" | "config";

export interface Credential {
  apiKey: string;
  source: CredentialSource;
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "weread", "config.json");
}

export async function readConfig(): Promise<WereadConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CliError("CONFIG_INVALID", `Config is not an object: ${configPath()}`);
    }
    const apiKey = (parsed as { apiKey?: unknown }).apiKey;
    return typeof apiKey === "string" ? { apiKey } : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new CliError("CONFIG_INVALID", `Config is not valid JSON: ${configPath()}`);
    }
    throw error;
  }
}

export async function writeConfig(config: WereadConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}

export async function findCredential(): Promise<Credential | undefined> {
  const environmentKey = process.env.WEREAD_API_KEY?.trim();
  if (environmentKey) {
    return { apiKey: environmentKey, source: "environment" };
  }

  const config = await readConfig();
  if (config.apiKey) {
    return { apiKey: config.apiKey, source: "config" };
  }
  return undefined;
}

export async function requireCredential(): Promise<Credential> {
  const credential = await findCredential();
  if (!credential) {
    throw new CliError(
      "AUTH_MISSING",
      "Set WEREAD_API_KEY or run `weread config set-key <wrk-...>` first.",
    );
  }
  return credential;
}

export async function requireApiKey(): Promise<string> {
  return (await requireCredential()).apiKey;
}

export function validateApiKey(apiKey: string): void {
  if (!apiKey.startsWith("wrk-") || apiKey.length < 8) {
    throw new CliError("CONFIG_INVALID", "API key should look like `wrk-...`.");
  }
}

export function redactKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;
  if (apiKey.length <= 10) return "wrk-...";
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

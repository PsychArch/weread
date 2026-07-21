import { errorPayload } from "./errors.js";
import { resolveGatewaySkillVersion } from "./client.js";
import { RESPONSE_SCHEMA_VERSION } from "./schemas.js";

export const JSON_SCHEMA_VERSION = RESPONSE_SCHEMA_VERSION;

export interface GlobalOptions {
  json?: boolean;
  agent?: boolean;
  raw?: boolean;
  skillVersion?: string;
}

export interface ResponseMetadata {
  gatewaySkillVersion?: string;
  timeZone?: string;
  warnings?: string[];
  operationId?: string;
  schemaId?: string;
}

let metadataProvider: (() => ResponseMetadata) | undefined;

export function setMetadataProvider(provider: () => ResponseMetadata): void {
  metadataProvider = provider;
}

function metadataWithDefaults(metadata: ResponseMetadata): ResponseMetadata {
  const provided = metadataProvider?.() ?? {};
  return {
    ...provided,
    ...metadata,
    warnings: [...new Set([...(provided.warnings ?? []), ...(metadata.warnings ?? [])])],
  };
}

function preserveGatewaySkillVersion(value: unknown, gatewaySkillVersion: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => preserveGatewaySkillVersion(entry, gatewaySkillVersion));
  }
  if (value === null || typeof value !== "object") return value;

  const record = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      preserveGatewaySkillVersion(entry, gatewaySkillVersion),
    ]),
  );
  if (record.hasMore === true && "nextArgs" in record && Array.isArray(record.nextArgv)) {
    const nextArgv = record.nextArgv.filter((entry): entry is string => typeof entry === "string");
    if (nextArgv.length === record.nextArgv.length) {
      if (nextArgv.at(-2) === "--skill-version") {
        record.nextArgv = [...nextArgv.slice(0, -1), gatewaySkillVersion];
      } else if (nextArgv.at(-1) === "--skill-version") {
        record.nextArgv = [...nextArgv, gatewaySkillVersion];
      } else {
        record.nextArgv = [...nextArgv, "--skill-version", gatewaySkillVersion];
      }
    }
  }
  return record;
}

export function jsonSuccess(data: unknown, metadata: ResponseMetadata = {}) {
  const gatewaySkillVersion = metadata.gatewaySkillVersion ?? resolveGatewaySkillVersion();
  return {
    ok: true,
    data: preserveGatewaySkillVersion(data, gatewaySkillVersion),
    meta: {
      schemaVersion: JSON_SCHEMA_VERSION,
      gatewaySkillVersion,
      complete: true,
      timeZone: metadata.timeZone ?? "Asia/Shanghai",
      ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
      ...(metadata.schemaId ? { schemaId: metadata.schemaId } : {}),
    },
    warnings: metadata.warnings ?? [],
  };
}

export function printResult(
  options: GlobalOptions,
  data: unknown,
  human: () => string,
  metadata: ResponseMetadata = {},
): void {
  metadata = metadataWithDefaults(metadata);
  if (options.raw) {
    console.log(JSON.stringify(data));
    return;
  }
  if (options.json || options.agent) {
    console.log(JSON.stringify(jsonSuccess(data, metadata)));
    return;
  }
  const text = human();
  if (text) console.log(text);
}

export function printError(options: GlobalOptions, error: unknown, metadata: ResponseMetadata = {}): void {
  metadata = metadataWithDefaults(metadata);
  const payload = errorPayload(error);
  if (options.json || options.agent) {
    console.error(JSON.stringify({
      ...payload,
      meta: {
        schemaVersion: JSON_SCHEMA_VERSION,
        gatewaySkillVersion: metadata.gatewaySkillVersion ?? resolveGatewaySkillVersion(),
        complete: false,
        timeZone: metadata.timeZone ?? "Asia/Shanghai",
        ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
        ...(metadata.schemaId ? { schemaId: metadata.schemaId } : {}),
      },
      warnings: metadata.warnings ?? [],
    }));
    return;
  }
  if (options.raw) {
    console.error(JSON.stringify(payload));
    return;
  }
  console.error(`${payload.error.code}: ${payload.error.message}`);
}

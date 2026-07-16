import { errorPayload } from "./errors.js";
import { SKILL_VERSION } from "./client.js";

export const AGENT_SCHEMA_VERSION = "2";

export interface GlobalOptions {
  json?: boolean;
  agent?: boolean;
  skillVersion?: string;
}

export interface AgentMetadata {
  gatewaySkillVersion?: string;
  complete?: boolean;
  timeZone?: string;
  warnings?: string[];
}

let metadataProvider: (() => AgentMetadata) | undefined;

export function setAgentMetadataProvider(provider: () => AgentMetadata): void {
  metadataProvider = provider;
}

function metadataWithDefaults(metadata: AgentMetadata): AgentMetadata {
  const provided = metadataProvider?.() ?? {};
  return {
    ...provided,
    ...metadata,
    warnings: [...new Set([...(provided.warnings ?? []), ...(metadata.warnings ?? [])])],
  };
}

export function agentSuccess(data: unknown, metadata: AgentMetadata = {}) {
  return {
    ok: true,
    data,
    meta: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      gatewaySkillVersion: metadata.gatewaySkillVersion ?? SKILL_VERSION,
      complete: metadata.complete ?? true,
      timeZone: metadata.timeZone ?? "Asia/Shanghai",
    },
    warnings: metadata.warnings ?? [],
  };
}

export function printResult(
  options: GlobalOptions,
  data: unknown,
  human: () => string,
  metadata: AgentMetadata = {},
): void {
  metadata = metadataWithDefaults(metadata);
  if (options.agent) {
    console.log(JSON.stringify(agentSuccess(data, metadata)));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(data));
    return;
  }
  const text = human();
  if (text) console.log(text);
}

export function printError(options: GlobalOptions, error: unknown, metadata: AgentMetadata = {}): void {
  metadata = metadataWithDefaults(metadata);
  const payload = errorPayload(error);
  if (options.agent) {
    console.error(JSON.stringify({
      ...payload,
      meta: {
        schemaVersion: AGENT_SCHEMA_VERSION,
        gatewaySkillVersion: metadata.gatewaySkillVersion ?? SKILL_VERSION,
        complete: false,
        timeZone: metadata.timeZone ?? "Asia/Shanghai",
      },
      warnings: metadata.warnings ?? [],
    }));
    return;
  }
  if (options.json) {
    console.error(JSON.stringify(payload));
    return;
  }
  console.error(`${payload.error.code}: ${payload.error.message}`);
}

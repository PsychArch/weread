import { CliError } from "./errors.js";

export const CORPUS_CURSOR_PREFIX = "wrc1.";
export const CORPUS_CURSOR_PATTERN = "^wrc1\\.[A-Za-z0-9_-]{1,480}$";

const MAX_CURSOR_LENGTH = 512;
const MAX_BOOK_ID_LENGTH = 256;

export interface CorpusCursorState {
  lastSort: number;
  lastBookId: string;
  emitted: number;
  totalBookCount: number;
}

export function encodeCorpusCursor(state: CorpusCursorState): string {
  assertCursorState(state);
  const canonical = canonicalState(state);
  const token = `${CORPUS_CURSOR_PREFIX}${Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url")}`;
  if (token.length > MAX_CURSOR_LENGTH) {
    throw new CliError("ARG_INVALID", "Corpus cursor state is too large to encode.");
  }
  return token;
}

export function decodeCorpusCursor(token: string): CorpusCursorState {
  if (token.length > MAX_CURSOR_LENGTH || !new RegExp(CORPUS_CURSOR_PATTERN).test(token)) {
    throw invalidCursor();
  }
  const payload = token.slice(CORPUS_CURSOR_PREFIX.length);
  let decoded: Buffer;
  let value: unknown;
  try {
    decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) throw invalidCursor();
    const json = decoded.toString("utf8");
    if (!Buffer.from(json, "utf8").equals(decoded)) throw invalidCursor();
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw invalidCursor();
  }
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "emitted,lastBookId,lastSort,totalBookCount") {
    throw invalidCursor();
  }
  const state: CorpusCursorState = {
    lastSort: value.lastSort as number,
    lastBookId: value.lastBookId as string,
    emitted: value.emitted as number,
    totalBookCount: value.totalBookCount as number,
  };
  assertCursorState(state);
  if (encodeCorpusCursor(state) !== token) throw invalidCursor();
  return state;
}

function canonicalState(state: CorpusCursorState): CorpusCursorState {
  return {
    lastSort: state.lastSort,
    lastBookId: state.lastBookId,
    emitted: state.emitted,
    totalBookCount: state.totalBookCount,
  };
}

function assertCursorState(state: CorpusCursorState): void {
  if (!Number.isSafeInteger(state.lastSort) || state.lastSort < 0
    || !Number.isSafeInteger(state.emitted) || state.emitted < 1
    || !Number.isSafeInteger(state.totalBookCount) || state.totalBookCount < state.emitted
    || typeof state.lastBookId !== "string"
    || state.lastBookId.length < 1
    || state.lastBookId.length > MAX_BOOK_ID_LENGTH
    || state.lastBookId.trim() !== state.lastBookId
    || /\s/.test(state.lastBookId)) {
    throw invalidCursor();
  }
}

function invalidCursor(): CliError {
  return new CliError("ARG_INVALID", "Invalid or unsupported notes corpus cursor; restart without --cursor.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

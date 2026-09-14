/** Builds and writes exact ranges from Pi session branches. */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { uuidv7 } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ModelChangeEntry,
  SessionEntry,
  SessionHeader,
  SessionMessageEntry,
  ThinkingLevelChangeEntry,
} from "@earendil-works/pi-coding-agent";

type LabelEntry = Extract<SessionEntry, { type: "label" }>;
type ReadonlySessionManager = ExtensionContext["sessionManager"];

/** Session file format understood by this extension. */
export const SUPPORTED_SESSION_VERSION = 3;

/** A user-message boundary shown by the picker. */
export interface SliceCandidate {
  id: string;
  ordinal: number;
  text: string;
  timestamp: string;
  total: number;
}

/** File-system operation used to persist a completed slice. */
export interface SliceFileSystem {
  writeFileSync: typeof writeFileSync;
}

/** Successful or expected-failure result of building a slice. */
export type BuildSliceResult =
  { copiedCount: number; entries: SessionEntry[] } | { reason: string };

const DEFAULT_FILE_SYSTEM: SliceFileSystem = { writeFileSync };

/** Build copied and synthetic entries for the selected boundary ids. */
export function buildSlice(
  branch: readonly SessionEntry[],
  startId: string,
  endId: string | null,
  now: Date = new Date(),
  createEntryId: (ids: ReadonlySet<string>) => string = generateEntryId,
): BuildSliceResult {
  const startIndex = branch.findIndex((entry) => entry.id === startId);

  if (startIndex < 0)
    return { reason: "The start message is no longer available." };

  const endIndex =
    endId === null
      ? branch.length
      : branch.findIndex((entry) => entry.id === endId);

  if (endIndex < 0)
    return { reason: "The end message is no longer available." };

  if (endIndex <= startIndex) {
    return { reason: "The end message must come after the start message." };
  }

  if (!isUserMessageEntry(branch[startIndex])) {
    return { reason: "The start boundary must be a user message." };
  }

  if (endId !== null && !isUserMessageEntry(branch[endIndex])) {
    return { reason: "The end boundary must be a user message." };
  }

  const ids = new Set(branch.map((entry) => entry.id));
  const timestamp = now.toISOString();
  const syntheticEntries = buildStateEntries(
    branch.slice(0, startIndex),
    ids,
    timestamp,
    createEntryId,
  );
  const copiedEntries = copyRange(
    branch.slice(startIndex, endIndex),
    syntheticEntries.at(-1)?.id ?? null,
  );

  if (copiedEntries.length === 0) {
    return { reason: "The selected range contains no session entries." };
  }

  const labels = buildLabelEntries(branch, copiedEntries, ids, createEntryId);

  return {
    copiedCount: copiedEntries.length,
    entries: [...syntheticEntries, ...copiedEntries, ...labels],
  };
}

/** Build picker candidates from Pi's compaction-aware context view. */
export function listCandidates(
  sessionManager: Pick<ReadonlySessionManager, "buildContextEntries">,
): SliceCandidate[] {
  const messages = sessionManager
    .buildContextEntries()
    .filter(isUserMessageEntry);
  const total = messages.length;

  return messages.map((entry, index) => ({
    id: entry.id,
    ordinal: index + 1,
    text: extractUserMessageText(entry.message.content),
    timestamp: entry.timestamp,
    total,
  }));
}

/** Write one new versioned session file and return its path. */
export function writeSliceFile(
  sessionDir: string,
  cwd: string,
  sourcePath: string,
  entries: readonly SessionEntry[],
  now: Date = new Date(),
  createSessionId: () => string = uuidv7,
  fs: SliceFileSystem = DEFAULT_FILE_SYSTEM,
): string {
  const timestamp = now.toISOString();
  const sessionId = createSessionId();
  const fileTimestamp = timestamp.replaceAll(/[:.]/g, "-");
  const destination = join(sessionDir, `${fileTimestamp}_${sessionId}.jsonl`);
  const header: SessionHeader = {
    type: "session",
    version: SUPPORTED_SESSION_VERSION,
    id: sessionId,
    timestamp,
    cwd,
    parentSession: sourcePath,
  };
  const contents = [header, ...entries]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  fs.writeFileSync(destination, `${contents}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  return destination;
}

function buildLabelEntries(
  branch: readonly SessionEntry[],
  copiedEntries: readonly SessionEntry[],
  ids: Set<string>,
  createEntryId: (ids: ReadonlySet<string>) => string,
): LabelEntry[] {
  const labels = new Map<string, { label: string; timestamp: string }>();

  for (const entry of branch) {
    if (entry.type !== "label") continue;

    if (entry.label) {
      labels.set(entry.targetId, {
        label: entry.label,
        timestamp: entry.timestamp,
      });
    } else {
      labels.delete(entry.targetId);
    }
  }

  const copiedIds = new Set(copiedEntries.map((entry) => entry.id));
  const output: LabelEntry[] = [];
  let parentId = copiedEntries.at(-1)?.id ?? null;

  for (const [targetId, value] of labels) {
    if (!copiedIds.has(targetId)) continue;

    const id = nextEntryId(ids, createEntryId);
    const entry: LabelEntry = {
      type: "label",
      id,
      parentId,
      timestamp: value.timestamp,
      targetId,
      label: value.label,
    };

    output.push(entry);
    parentId = id;
  }

  return output;
}

function buildStateEntries(
  prefix: readonly SessionEntry[],
  ids: Set<string>,
  timestamp: string,
  createEntryId: (ids: ReadonlySet<string>) => string,
): (ModelChangeEntry | ThinkingLevelChangeEntry)[] {
  let model: ModelChangeEntry | undefined;
  let thinking: ThinkingLevelChangeEntry | undefined;

  for (const entry of prefix) {
    if (entry.type === "model_change") model = entry;
    if (entry.type === "thinking_level_change") thinking = entry;
  }

  const entries: (ModelChangeEntry | ThinkingLevelChangeEntry)[] = [];
  let parentId: string | null = null;

  if (model) {
    const id = nextEntryId(ids, createEntryId);

    entries.push({
      type: "model_change",
      id,
      parentId,
      timestamp,
      provider: model.provider,
      modelId: model.modelId,
    });
    parentId = id;
  }

  if (thinking) {
    const id = nextEntryId(ids, createEntryId);

    entries.push({
      type: "thinking_level_change",
      id,
      parentId,
      timestamp,
      thinkingLevel: thinking.thinkingLevel,
    });
  }

  return entries;
}

function copyRange(
  range: readonly SessionEntry[],
  initialParentId: string | null,
): SessionEntry[] {
  const output: SessionEntry[] = [];
  let parentId = initialParentId;

  for (const entry of range) {
    if (
      entry.type === "label" ||
      entry.type === "compaction" ||
      entry.type === "session_info"
    ) {
      continue;
    }

    const copy = entry.parentId === parentId ? entry : { ...entry, parentId };

    output.push(copy);
    parentId = copy.id;
  }

  return output;
}

function extractUserMessageText(
  content: string | readonly { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;

  return content
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function generateEntryId(ids: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = randomUUID().slice(0, 8);

    if (!ids.has(id)) return id;
  }

  return randomUUID();
}

function isUserMessageEntry(
  entry: SessionEntry | undefined,
): entry is SessionMessageEntry & {
  message: Extract<SessionMessageEntry["message"], { role: "user" }>;
} {
  return entry?.type === "message" && entry.message.role === "user";
}

function nextEntryId(
  ids: Set<string>,
  createEntryId: (ids: ReadonlySet<string>) => string,
): string {
  const id = createEntryId(ids);

  if (ids.has(id)) {
    throw new Error(`Entry id generator returned duplicate id ${id}.`);
  }

  ids.add(id);

  return id;
}

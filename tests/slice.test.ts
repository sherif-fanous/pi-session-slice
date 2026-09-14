/** Covers candidate projection, exact range copying, state, labels, and JSONL output. */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSlice,
  listCandidates,
  SUPPORTED_SESSION_VERSION,
  writeSliceFile,
  type SliceFileSystem,
} from "../src/slice.js";
import {
  buildContextEntries,
  SessionManager,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const TIMESTAMP = "2026-03-10T12:00:00.000Z";
const temporaryDirectories: string[] = [];

function assistant(id: string, parentId: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: TIMESTAMP,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.parse(TIMESTAMP),
    },
  };
}

function customMessage(id: string, parentId: string): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: TIMESTAMP,
    customType: "test",
    content: "custom context",
    display: true,
  };
}

function deterministicIds(
  ...values: string[]
): (ids: ReadonlySet<string>) => string {
  let index = 0;

  return () => values[index++] ?? `generated-${index}`;
}

function entryAt(
  entries: readonly SessionEntry[],
  index: number,
): SessionEntry {
  const entry = entries[index];

  if (!entry) throw new Error(`Missing fixture entry at index ${index}.`);

  return entry;
}

function messageAt(entries: readonly SessionEntry[], index: number) {
  const entry = entryAt(entries, index);

  if (entry.type !== "message") {
    throw new Error(`Fixture entry at index ${index} is not a message.`);
  }

  return entry.message;
}

function model(id: string, parentId: string | null): SessionEntry {
  return {
    type: "model_change",
    id,
    parentId,
    timestamp: TIMESTAMP,
    provider: "anthropic",
    modelId: "claude-test",
  };
}

function thinking(id: string, parentId: string): SessionEntry {
  return {
    type: "thinking_level_change",
    id,
    parentId,
    timestamp: TIMESTAMP,
    thinkingLevel: "high",
  };
}

function toolCall(id: string, parentId: string): SessionEntry {
  const entry = assistant(id, parentId, "");

  if (entry.type === "message" && entry.message.role === "assistant") {
    entry.message.content = [
      { type: "toolCall", id: "call-1", name: "read", arguments: {} },
    ];
    entry.message.stopReason = "toolUse";
  }

  return entry;
}

function toolResult(id: string, parentId: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: TIMESTAMP,
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "file" }],
      isError: false,
      timestamp: Date.parse(TIMESTAMP),
    },
  };
}

function user(id: string, parentId: string | null, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: TIMESTAMP,
    message: {
      role: "user",
      content: text,
      timestamp: Date.parse(TIMESTAMP),
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("listCandidates", () => {
  it("returns only user messages in context order", () => {
    const contextEntries = [
      user("u1", null, "first"),
      model("m1", "u1"),
      assistant("a1", "m1", "reply"),
      customMessage("c1", "a1"),
      user("u2", "c1", "second"),
    ];

    expect(
      listCandidates({ buildContextEntries: () => contextEntries }),
    ).toEqual([
      {
        id: "u1",
        ordinal: 1,
        text: "first",
        timestamp: TIMESTAMP,
        total: 2,
      },
      {
        id: "u2",
        ordinal: 2,
        text: "second",
        timestamp: TIMESTAMP,
        total: 2,
      },
    ]);
  });

  it("excludes tool-result and bash-execution messages", () => {
    const contextEntries: SessionEntry[] = [
      user("u1", null, "keep"),
      toolResult("tool-result", "u1"),
      {
        type: "message",
        id: "bash",
        parentId: "tool-result",
        timestamp: TIMESTAMP,
        message: {
          role: "bashExecution",
          command: "pwd",
          output: "/project",
          exitCode: 0,
          cancelled: false,
          truncated: false,
          timestamp: Date.parse(TIMESTAMP),
        },
      },
    ];

    expect(
      listCandidates({ buildContextEntries: () => contextEntries }),
    ).toEqual([expect.objectContaining({ id: "u1", ordinal: 1, total: 1 })]);
  });

  it("includes retained messages and excludes compaction-hidden messages", () => {
    const branch: SessionEntry[] = [
      user("u1", null, "hidden"),
      assistant("a1", "u1", "hidden reply"),
      user("u2", "a1", "retained"),
      assistant("a2", "u2", "retained reply"),
      {
        type: "compaction",
        id: "compact",
        parentId: "a2",
        timestamp: TIMESTAMP,
        summary: "summary",
        firstKeptEntryId: "u2",
        tokensBefore: 10,
      },
      user("u3", "compact", "after"),
    ];
    const context = buildContextEntries(branch);

    expect(listCandidates({ buildContextEntries: () => context })).toEqual([
      expect.objectContaining({ id: "u2", ordinal: 1, text: "retained" }),
      expect.objectContaining({ id: "u3", ordinal: 2, text: "after" }),
    ]);
  });
});

describe("buildSlice", () => {
  it("copies tool and custom entries without changing their data", () => {
    const branch = [
      user("u1", null, "drop"),
      user("u2", "u1", "keep"),
      toolCall("a2", "u2"),
      toolResult("t2", "a2"),
      customMessage("c2", "t2"),
      user("u3", "c2", "editor"),
    ];
    const result = buildSlice(branch, "u2", "u3");

    expect(result).toEqual({
      copiedCount: 4,
      entries: [
        { ...entryAt(branch, 1), parentId: null },
        entryAt(branch, 2),
        entryAt(branch, 3),
        entryAt(branch, 4),
      ],
    });

    if ("entries" in result) {
      const untouchedToolCall = entryAt(branch, 2);

      expect(result.entries[1]).toBe(untouchedToolCall);
      expect(JSON.stringify(result.entries[1])).toBe(
        JSON.stringify(untouchedToolCall),
      );

      expect(result.entries[2]).toMatchObject({
        id: "t2",
        message: { toolCallId: "call-1" },
        timestamp: TIMESTAMP,
      });
    }
  });

  it("preserves custom, bash, and branch-summary entries", () => {
    const branch: SessionEntry[] = [
      user("u1", null, "keep"),
      {
        type: "custom",
        id: "custom",
        parentId: "u1",
        timestamp: TIMESTAMP,
        customType: "state",
        data: { enabled: true },
      },
      {
        type: "message",
        id: "bash",
        parentId: "custom",
        timestamp: TIMESTAMP,
        message: {
          role: "bashExecution",
          command: "pwd",
          output: "/project",
          exitCode: 0,
          cancelled: false,
          truncated: false,
          timestamp: Date.parse(TIMESTAMP),
        },
      },
      {
        type: "branch_summary",
        id: "summary",
        parentId: "bash",
        timestamp: TIMESTAMP,
        fromId: "old-leaf",
        summary: "Earlier branch",
      },
      assistant("a1", "summary", "reply"),
    ];
    const result = buildSlice(branch, "u1", null);

    expect(result).toEqual({ copiedCount: 5, entries: branch });

    if ("entries" in result) {
      for (let index = 0; index < branch.length; index += 1) {
        expect(result.entries[index]).toBe(entryAt(branch, index));
      }
    }
  });

  it("strips a compaction after a retained start and re-chains around it", () => {
    const branch: SessionEntry[] = [
      user("u1", null, "old"),
      assistant("a1", "u1", "old reply"),
      user("u2", "a1", "retained"),
      assistant("a2", "u2", "retained reply"),
      {
        type: "compaction",
        id: "compact",
        parentId: "a2",
        timestamp: TIMESTAMP,
        summary: "summary",
        firstKeptEntryId: "u2",
        tokensBefore: 10,
      },
      user("u3", "compact", "after"),
      assistant("a3", "u3", "after reply"),
    ];

    expect(buildSlice(branch, "u2", null)).toEqual({
      copiedCount: 4,
      entries: [
        { ...entryAt(branch, 2), parentId: null },
        entryAt(branch, 3),
        { ...entryAt(branch, 5), parentId: "a2" },
        entryAt(branch, 6),
      ],
    });

    expect(buildSlice(branch, "u3", null)).toEqual({
      copiedCount: 2,
      entries: [{ ...entryAt(branch, 5), parentId: null }, entryAt(branch, 6)],
    });
  });

  it("carries the effective model and thinking level but not the name", () => {
    const branch: SessionEntry[] = [
      model("m1", null),
      thinking("t1", "m1"),
      {
        type: "session_info",
        id: "name",
        parentId: "t1",
        timestamp: TIMESTAMP,
        name: "Source name",
      },
      user("u1", "name", "keep"),
      assistant("a1", "u1", "reply"),
    ];
    const result = buildSlice(
      branch,
      "u1",
      null,
      new Date(TIMESTAMP),
      deterministicIds("new-model", "new-thinking"),
    );

    expect(result).toEqual({
      copiedCount: 2,
      entries: [
        { ...entryAt(branch, 0), id: "new-model", parentId: null },
        { ...entryAt(branch, 1), id: "new-thinking", parentId: "new-model" },
        { ...entryAt(branch, 3), parentId: "new-thinking" },
        entryAt(branch, 4),
      ],
    });

    if ("entries" in result) {
      expect(
        result.entries.some((entry) => entry.type === "session_info"),
      ).toBe(false);
    }
  });

  it("carries the latest model and thinking changes before the start", () => {
    const branch: SessionEntry[] = [
      model("model-old", null),
      thinking("thinking-old", "model-old"),
      {
        type: "model_change",
        id: "model-latest",
        parentId: "thinking-old",
        timestamp: TIMESTAMP,
        provider: "openai",
        modelId: "gpt-latest",
      },
      {
        type: "thinking_level_change",
        id: "thinking-latest",
        parentId: "model-latest",
        timestamp: TIMESTAMP,
        thinkingLevel: "xhigh",
      },
      user("u1", "thinking-latest", "keep"),
      assistant("a1", "u1", "reply"),
    ];
    const result = buildSlice(
      branch,
      "u1",
      null,
      new Date(TIMESTAMP),
      deterministicIds("new-model", "new-thinking"),
    );

    if ("reason" in result) throw new Error(result.reason);

    expect(result.copiedCount).toBe(2);
    expect(result.entries[0]).toMatchObject({
      provider: "openai",
      modelId: "gpt-latest",
    });
    expect(result.entries[1]).toMatchObject({ thinkingLevel: "xhigh" });
  });

  it("adds no synthetic state when the prefix has none", () => {
    const branch = [user("u1", null, "keep"), assistant("a1", "u1", "reply")];

    expect(buildSlice(branch, "u1", null)).toEqual({
      copiedCount: 2,
      entries: branch,
    });
  });

  it("strips a source rename inside the selected range", () => {
    const branch: SessionEntry[] = [
      user("u1", null, "keep"),
      {
        type: "session_info",
        id: "name",
        parentId: "u1",
        timestamp: TIMESTAMP,
        name: "Source name",
      },
      assistant("a1", "name", "reply"),
    ];

    expect(buildSlice(branch, "u1", null)).toEqual({
      copiedCount: 2,
      entries: [entryAt(branch, 0), { ...entryAt(branch, 2), parentId: "u1" }],
    });
  });

  it("writes a label that resolves on the new session", async () => {
    const branch: SessionEntry[] = [
      user("u1", null, "keep"),
      {
        type: "label",
        id: "label-old",
        parentId: "u1",
        timestamp: "2026-03-10T12:01:00.000Z",
        targetId: "u1",
        label: "old",
      },
      assistant("a1", "label-old", "reply"),
      {
        type: "label",
        id: "label-new",
        parentId: "a1",
        timestamp: "2026-03-10T12:02:00.000Z",
        targetId: "u1",
        label: "current",
      },
    ];
    const result = buildSlice(
      branch,
      "u1",
      null,
      new Date(TIMESTAMP),
      deterministicIds("new-label"),
    );

    if ("reason" in result) throw new Error(result.reason);

    const directory = await mkdtemp(join(tmpdir(), "pi-session-slice-label-"));

    temporaryDirectories.push(directory);

    const destination = writeSliceFile(
      directory,
      "/project",
      "/sessions/source.jsonl",
      result.entries,
      new Date(TIMESTAMP),
      () => "label-session",
    );

    expect(SessionManager.open(destination).getLabel("u1")).toBe("current");
  });

  it("returns reasons for missing and reversed boundaries", () => {
    const branch = [user("u1", null, "one"), user("u2", "u1", "two")];

    expect(buildSlice(branch, "missing", null)).toEqual({
      reason: "The start message is no longer available.",
    });

    expect(buildSlice(branch, "u1", "missing")).toEqual({
      reason: "The end message is no longer available.",
    });

    expect(buildSlice(branch, "u2", "u1")).toEqual({
      reason: "The end message must come after the start message.",
    });
  });
});

describe("writeSliceFile", () => {
  it("round-trips a pre-compaction start without restoring the compaction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "pi-session-slice-compact-"),
    );

    temporaryDirectories.push(directory);

    const branch: SessionEntry[] = [
      user("u1", null, "hidden"),
      assistant("a1", "u1", "hidden reply"),
      user("u2", "a1", "retained"),
      assistant("a2", "u2", "retained reply"),
      {
        type: "compaction",
        id: "compact",
        parentId: "a2",
        timestamp: TIMESTAMP,
        summary: "summary",
        firstKeptEntryId: "u2",
        tokensBefore: 10,
      },
      user("u3", "compact", "after"),
      assistant("a3", "u3", "after reply"),
    ];
    const result = buildSlice(branch, "u2", null);

    if ("reason" in result) throw new Error(result.reason);

    const destination = writeSliceFile(
      directory,
      "/project",
      "/sessions/source.jsonl",
      result.entries,
      new Date(TIMESTAMP),
      () => "compact-session",
    );
    const loaded = SessionManager.open(destination);

    expect(loaded.getEntries()).toEqual(result.entries);
    expect(
      loaded.getEntries().some((entry) => entry.type === "compaction"),
    ).toBe(false);

    expect(loaded.buildSessionContext().messages).toEqual([
      messageAt(branch, 2),
      messageAt(branch, 3),
      messageAt(branch, 5),
      messageAt(branch, 6),
    ]);
  });

  it("does not change the source after a successful write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-slice-source-"));

    temporaryDirectories.push(directory);

    const source = join(directory, "source.jsonl");
    const sourceBytes = Buffer.from('{"source":true}\n');

    await writeFile(source, sourceBytes);

    const before = await readdir(directory);
    const destination = writeSliceFile(
      directory,
      "/project",
      source,
      [user("u1", null, "hello")],
      new Date(TIMESTAMP),
      () => "successful-session",
    );
    const after = await readdir(directory);

    expect(await readFile(source)).toEqual(sourceBytes);
    expect(before).toEqual(["source.jsonl"]);
    expect(after.filter((path) => join(directory, path) !== source)).toEqual([
      destination.slice(directory.length + 1),
    ]);
  });

  it("calls the writer once with a destination distinct from the source", () => {
    const destinations: string[] = [];
    const recordingFs: SliceFileSystem = {
      writeFileSync: (path) => {
        destinations.push(String(path));
      },
    };
    const source = "/sessions/source.jsonl";
    const destination = writeSliceFile(
      "/sessions",
      "/project",
      source,
      [user("u1", null, "hello")],
      new Date(TIMESTAMP),
      () => "recorded-session",
      recordingFs,
    );

    expect(destinations).toEqual([destination]);
    expect(destination).not.toBe(source);
  });

  it("does not change the source when the destination write fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-slice-source-"));

    temporaryDirectories.push(directory);

    const source = join(directory, "source.jsonl");
    const sourceBytes = Buffer.from('{"source":true}\n');
    const failingFs: SliceFileSystem = {
      writeFileSync: () => {
        throw new Error("simulated write failure");
      },
    };

    await writeFile(source, sourceBytes);

    expect(() =>
      writeSliceFile(
        directory,
        "/project",
        source,
        [user("u1", null, "hello")],
        new Date(TIMESTAMP),
        () => "failed-session",
        failingFs,
      ),
    ).toThrow("simulated write failure");
    expect(await readFile(source)).toEqual(sourceBytes);
  });

  it("writes a loadable v3 session with lineage and restored model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-slice-"));

    temporaryDirectories.push(directory);

    const entries: SessionEntry[] = [
      { ...model("model", null), timestamp: TIMESTAMP },
      user("u1", "model", "hello"),
      assistant("a1", "u1", "hi"),
    ];
    const destination = writeSliceFile(
      directory,
      "/project",
      "/sessions/source.jsonl",
      entries,
      new Date(TIMESTAMP),
      () => "session-id",
    );
    const lines = (await readFile(destination, "utf8")).trim().split("\n");
    const header = JSON.parse(lines[0] ?? "null") as SessionHeader;
    const loaded = SessionManager.open(destination);

    expect(header).toEqual({
      type: "session",
      version: SUPPORTED_SESSION_VERSION,
      id: "session-id",
      timestamp: TIMESTAMP,
      cwd: "/project",
      parentSession: "/sessions/source.jsonl",
    });
    expect(lines).toHaveLength(entries.length + 1);
    expect(loaded.buildSessionContext()).toMatchObject({
      messages: [messageAt(entries, 1), messageAt(entries, 2)],
      model: { provider: "anthropic", modelId: "claude-test" },
    });
  });
});

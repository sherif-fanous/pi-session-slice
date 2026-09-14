## Context

See proposal.md for motivation. Facts about Pi (0.85.x) that shape the approach,
all verified against the installed `@earendil-works/pi-coding-agent` dist:

- A session is an append-only JSONL tree: a `session` header line, then entries
  with `id`, `parentId`, `timestamp`, `type`. Current format version is 3
  (`CURRENT_SESSION_VERSION`).
- `ctx.sessionManager` (read-only) exposes `getBranch()`,
  `buildContextEntries()`, `getEntries()`, `getHeader()`, `getSessionFile()`,
  `getSessionDir()`, `getLabel()`. It exposes no way to append an entry with a
  caller-supplied id or timestamp, and no way to append compaction or label
  entries.
- `/fork` is implemented by `SessionManager.createBranchedSession()`, which
  writes a new JSONL file directly: re-chains `parentId`s, strips label entries
  and re-emits them at the tail, sets `parentSession` in the header, then the
  runtime calls `switchSession`. That method is not on the extension surface.
- On `switchSession`, Pi rebuilds the runtime and restores the model and
  thinking level **from the target session's own entries**; absent those, it
  falls back to settings defaults, not to the previously active model.
- `/fork`'s default position is `"before"`: the new leaf is the selected user
  message's parent, and the message text is returned as `selectedText` and put
  into the editor. Extensions get the same effect via `ctx.ui.setEditorText()`.
- Pi's `transformMessages` already patches orphaned tool calls with synthetic
  error results and drops errored/aborted assistant turns. It does nothing for
  orphaned tool results or assistant-first conversations.
- The `/fork` picker (`UserMessageSelector`, ~110 lines) is a pi-tui component
  rendering two lines per row; it is not exported. Extensions can mount their
  own components via `ctx.ui.custom()`.
- Pi has no relative-time formatter.

## Goals / Non-Goals

**Goals:**

- Byte-faithful copy of the selected entries; the only edit is `parentId = null`
  on the first copied entry.
- Zero conversation-shape repair logic, achieved by restricting boundaries to
  user messages.
- Look and feel indistinguishable from `/fork`'s picker.
- Single-file extension plus one small component; no runtime dependencies beyond
  what Pi already ships.

**Non-Goals:**

- Text forms of the command (`/slice from 89`, `--from <id>`, `--last N`).
- Assistant-side boundaries or per-entry selection.
- `/tree`-style filters, search, or label-only views in the picker.
- Handoff summaries, compaction, or any model call.
- Deleting or rewriting the root-level `pi-session-slice-requirements.md`; it is
  superseded by this change and can be removed separately.

## Decisions

### D1: Write the session file directly, then `ctx.switchSession()`

**Chosen.** Read the branch via `ctx.sessionManager`, build the output entry
list, write `<sessionDir>/<timestamp>_<id>.jsonl` with a version-3 header whose
`parentSession` is the source path and `cwd` is the source cwd, then call
`ctx.switchSession(path, { withSession })`.

**Alternative rejected:** `ctx.newSession({ setup })` and re-append entries
through `SessionManager.appendMessage()` etc. Every append mints a fresh id and
timestamp, and there is no append method for compaction or label entries. This
cannot meet the verbatim requirement.

**Consequence:** the extension depends on the session file format. Mitigation in
R1.

### D2: Boundaries are user messages only; start inclusive, end exclusive

**Chosen.** Both pickers list user messages. Start is inclusive (opens the new
session). End is exclusive and its text goes to the editor, exactly as `/fork`'s
`"before"` position.

**Rationale:** the first message of an LLM conversation must be `user` for
Anthropic and is safest everywhere. Any cut after the final assistant text of a
turn is identical to a cut before the next user message, so allowing assistant
rows adds a second way to express the same file plus the need to define "which
assistant entry counts" amid tool loops. Restricting to user messages makes
empty slices, orphaned tool results, and assistant-first openings
unrepresentable.

### D3: Candidates come from `buildContextEntries()`, not `getBranch()`

**Chosen.** List every user message from the compaction-aware context view in
the order it returns them. This includes entries at and after the latest
compaction's `firstKeptEntryId`, even though some precede the compaction entry in
the raw branch. Entries summarized away by an earlier compaction are not
offered.

**Rationale:** the picker should show what the model sees. The copied entries
are taken from `getBranch()` (raw, in order) between the two boundary ids.
Compaction entries inside that raw range are stripped and the chain is re-linked
around them. Because the context view places the compaction summary before its
kept entries, every selectable start follows the summary in model context; the
new session therefore does not need the compaction. Raw order among retained
entries and post-compaction entries remains their context order.

### D4: Carry forward model and thinking level as synthetic head entries

**Chosen.** Before the first copied entry, write: a `model_change` entry if any
`model_change` exists on the branch before the start; a `thinking_level_change`
entry likewise. These get fresh ids and the current timestamp and are chained
ahead of the start entry (the start entry's `parentId` points at the last
synthetic entry, or null if none).

**Rationale:** verified behavior in Context: without these, `switchSession`
silently falls back to the default model. `/fork` never hits this because it
keeps the prefix. Two synthetic lines is the minimum deviation from "verbatim"
that makes the result usable.

**Alternatives rejected:** leave them out and document it (silent model switches
are a footgun); also carry forward the session name as `"<name> (slice)"`. The
name is cosmetic (only the `/resume` list reads it), the slice is a new session,
its first message is the start prompt the user chose so it is already
identifiable, and `parentSession` records lineage. Users run `/name` if they
want one.

### D5: Strip structural entries and re-emit labels at the tail

**Chosen.** Label, compaction, and session-info entries can be parents of later
entries. Copy the range excluding all three types and re-chain around them.
Append fresh `label` entries (new ids, original label timestamps) for any target
id inside the copied set. Compactions are dropped because they do not belong
after a selectable start in model context. Session-info entries are dropped and
never re-emitted because they describe the source session's identity; the new
session is unnamed. This extends the `createBranchedSession` approach, which
already strips and re-emits labels.

### D6: Two sequential pickers, cloned from `UserMessageSelector`

**Chosen.** Port the `/fork` selector into the extension as a pi-tui component
mounted with `ctx.ui.custom()`. Same two-line rows, same keybindings, same
scroll indicator. Secondary line becomes `Message N of M · <ago>`; in the end
picker it appends `· goes to your editor`. The end picker's first row is
`Keep everything to the end` and is pre-selected. Titles:
`Slice: start at message` and `Slice: end before message`; the end picker's
scroll hint includes `from message N`.

**Alternatives rejected:** `ctx.ui.select()` (one-line string rows, no secondary
line, doesn't match `/fork`); a single stateful picker with mark-start/mark-end
keys (more UI state, harder to explain, no reuse of the existing component
shape). `ctx.ui.select()` remains the documented fallback if `ctx.ui.custom`
proves unworkable.

### D7: Relative time is a ten-line local helper

`< 60s` → `just now`; `< 60m` → `Nm ago`; `< 24h` → `Nh ago`; `< 7d` → `Nd ago`;
else short date such as `Mar 3`. No weeks or months. Lives in the extension; no
dependency.

### D8: Refuse only on hard preconditions; do not detect pointless slices

Refuse with `ctx.ui.notify(..., "warning")` when: `getSessionFile()` is
undefined (`--no-session`; slicing needs a file for `switchSession`, and
extensions cannot replace the in-memory session the way `/fork` does);
`!ctx.isIdle()`; zero user messages in
context; source header version ≠ 3. Do not warn when the range equals the whole branch; the README explains the
behavior. Do not check that the source file exists on disk: Pi assigns the
path at creation and writes it on the first assistant reply, and neither
`/fork` nor slicing reads the file; the path is only recorded as
`parentSession`.

### D9: Order of operations on success

1. Build entries in memory and validate the list is non-empty.
2. Write the file (single `writeFileSync`).
3. `ctx.switchSession(path, { withSession })`.
4. Inside `withSession`: if an end message was chosen,
   `ctx.ui.setEditorText(text)`.
5. After `switchSession` returns without `cancelled`, notify
   "Sliced N entries into a new session" through the ctx that `withSession`
   received (captured in step 4). The original ctx is invalidated when the old
   session is disposed, and Pi's own "Resumed session" status is printed after
   `withSession` returns and replaces any status notified inside it.

If step 2 throws, notify the error and return; nothing else has happened. If
step 3 returns `cancelled` (an extension vetoed the switch), notify with the
path of the file that was written so it can be resumed manually.

### D10: Package layout

Tooling mirrors `pi-presets-plus`: pnpm, mise tasks, TypeScript 6, ESLint plus
Biome, Vitest, Prettier; `mise run check` is the gate. `package.json` declares
`"pi": { "extensions": ["./src/index.ts"] }`. Source under `src/`:
`index.ts` (command registration, precondition checks, orchestration),
`slice.ts` (candidate listing, slice builder, carry-forward, file writer),
`picker.ts` (the ported selector), `time.ts` (relative time). Tests under
`tests/*.test.ts` target the pure functions (slice builder, time formatter)
with in-memory entry fixtures; the picker and switch are exercised manually.

## Risks / Trade-offs

- [R1: Coupling to session file format v3] → Read `version` from the source
  header; refuse any other value. Pin the tested Pi version in the README. Keep
  the writer isolated in one function so a format bump is a local change.
- [R2: `ctx.ui.custom` / pi-tui component API is less stable than
  `ctx.ui.select`] → The picker is one file with no logic beyond rendering and
  key handling; fall back to `ctx.ui.select()` with single-line rows if it
  breaks.
- [R3: The new session's suffix may reference context that no longer exists] →
  Inherent to the feature and the user's choice. README states that slicing
  works best at a topic change; the picker's preview and timestamp exist to help
  find one.
- [R4: Synthetic head entries are not verbatim] → Deliberate, minimal, and
  limited to state entries that do not enter LLM context (model/thinking).
  Documented.
- [R5: Another extension's `session_before_switch` handler could cancel the
  switch after the file is written] → Handled in D9: report the written path so
  nothing is lost.
- [R6: Thinking signatures / provider-specific assistant content copied across a
  model switch] → Not a new risk; Pi's `transformMessages` already strips
  foreign thought signatures when the model differs. The carried-forward
  `model_change` keeps the same model anyway.

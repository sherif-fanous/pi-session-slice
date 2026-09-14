## 1. Package scaffold

- [x] 1.1 Tooling scaffold (`package.json` as `@sherif-fanous/pi-session-slice`
      with `"pi": { "extensions": ["./src/index.ts"] }`, `mise.toml`,
      `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`,
      `pnpm-workspace.yaml`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
      `LICENSE`) mirrored from `pi-presets-plus`; verified `pnpm install`,
      `mise run check`, and `pnpm pack --dry-run` pass
- [x] 1.2 Create `src/index.ts` exporting a default extension function that
      registers `/slice` with a placeholder handler; verify `mise run check`
      passes with a first test file under `tests/`
- [x] 1.3 Verify Pi loads the extension locally (`pi -e ./src/index.ts` or project
      `.pi/extensions` link) and `/slice` appears in the command list with the
      description "Start a new session from a range of this one"

## 2. Relative time helper (`src/time.ts`)

- [x] 2.1 Implement `formatAgo(iso: string, now?: Date): string` per design D7
      (just now / Nm / Nh / Nd / short date) and verify unit tests cover each
      threshold boundary (59s, 60s, 59m, 60m, 23h, 24h, 6d, 7d)

## 3. Slice builder (`src/slice.ts`, pure functions)

- [x] 3.1 Implement `listCandidates(sm)` returning user-message entries from
      `sm.buildContextEntries()` in context order, with ordinal and text
      preview; verify tests show compaction-retained messages are included while
      compaction-hidden messages and non-user entries are excluded
- [x] 3.2 Implement `buildSlice(branch, startId, endId | null)` returning the
      raw `getBranch()` entries from `startId` up to (excluding) `endId`, with
      label, compaction, and session-info entries removed and `parentId`s
      re-chained; verify a tool-loop test preserves ids, timestamps, and toolCallId, and a compaction
      test starting at a retained pre-compaction message produces a chain with
      the compaction removed
- [x] 3.3 Implement carry-forward: find the latest `model_change` and
      `thinking_level_change` before `startId` on the branch and prepend
      synthetic entries (fresh ids, current timestamp) chained ahead of the
      start entry per design D4; verify tests for "model set before boundary",
      "no state entries", "named source session → no `session_info` entry in the
      slice", and "source renamed inside the range → the entry is stripped"
- [x] 3.4 Implement label re-emission: for every source label whose `targetId`
      is inside the copied set, append a fresh `label` entry at the tail with
      the original label timestamp per design D5; verify a test that a labelled
      entry in range resolves to the same label
- [x] 3.5 Implement `writeSliceFile(sessionDir, cwd, sourcePath, entries)`
      producing a v3 header with `parentSession = sourcePath` followed by one
      JSON line per entry; verify a round-trip test loads the file with
      `SessionManager.open()` and `buildSessionContext().messages` equals the
      expected message list and `.model` equals the carried-forward model

## 4. Picker component (`src/picker.ts`)

- [x] 4.1 Port `UserMessageSelector` from Pi's interactive mode into a pi-tui
      component usable via `ctx.ui.custom()`: two-line rows (bold text line,
      muted `Message N of M · <ago>` line), up/down with wrap, Enter selects,
      Escape cancels, scroll indicator; verify manually in Pi that it is
      visually indistinguishable from `/fork`'s picker
- [x] 4.2 Add end-picker mode: a pre-selected first row
      `Keep everything to the end`, rows restricted to messages after the start,
      secondary line suffix `· goes to your editor`, scroll hint
      `from message N`; verify manually that Enter-Enter from `/slice` produces
      the keep-to-end result

## 5. Command wiring (`src/index.ts`)

- [x] 5.1 Register `/slice` and implement precondition checks per design D8 (no
      session file path, not idle, zero candidates, header version ≠ 3) each calling
      `ctx.ui.notify(..., "warning")` and returning; verify manually with
      `pi --no-session` and with a brand-new session that the correct
      notification appears and no file is written
- [x] 5.2 Wire start picker → end picker → `buildSlice` → `writeSliceFile` →
      `ctx.switchSession(path, { withSession })`; inside `withSession` call
      `ctx.ui.setEditorText(endText)` when an end was chosen and
      `ctx.ui.notify("Sliced N entries into a new session")`; verify manually
      that both keep-to-end and explicit-end flows switch sessions and the
      editor state matches
- [x] 5.3 Handle failures per design D9: write error → notify and abort;
      `switchSession` cancelled → notify with the written path; verify by making
      the session dir read-only and confirming the source session is untouched
      and still active

## 6. Integration verification

- [x] 6.1 End-to-end: in a session with ≥ 6 user turns, a tool loop, a label,
      and a model switch, run `/slice`, pick turn 3 as start and turn 5 as end;
      verify with `openspec`-independent inspection (`jq` on both files) that
      the source is byte-identical (`shasum` before/after), the new file
      contains exactly the expected entry ids in order, `parentSession` points
      at the source, and the new session opens with the same model and the
      turn-5 text in the editor
- [x] 6.2 Verify Escape at each picker leaves no new file in the session
      directory (`ls` count unchanged)
- [x] 6.3 Verify no provider request occurs during a slice by running with
      network disabled and confirming the flow completes

## 7. Documentation

- [x] 7.1 Write `README.md`: what `/slice` does, inclusive/exclusive boundary
      semantics with the editor pre-fill, that only user messages are selectable
      and why, that identical slices are allowed, the tested Pi version and
      session format version, and the note that slicing works best at a topic
      change; verify it renders and every documented behavior matches a spec
      scenario

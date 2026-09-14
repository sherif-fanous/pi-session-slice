## Why

Long Pi sessions accumulate abandoned exploration and dead ends that keep being
sent to the model on every turn. Pi's existing tools either keep the _prefix_
(`/fork`), hide content in place (`/tree`, folding extensions), or summarize
with an LLM call (`/compact`). There is no way to say "start a fresh session
that contains exactly this stretch of the conversation, verbatim, and nothing
before it."

## What Changes

- New Pi extension package `pi-session-slice` that registers a `/slice` command.
- `/slice` presents two pickers of user messages from the current context: the
  first prompt to keep (inclusive) and, optionally, the prompt at which to stop
  (exclusive, defaulting to the end of the session).
- The chosen range is written verbatim to a **new** session file, with the start
  entry re-rooted and the effective model and thinking level carried forward.
  The new session is unnamed. The new file records the source session as its
  parent.
- Pi switches to the new session automatically. When an end boundary was chosen,
  its prompt text is placed in the editor, mirroring `/fork`.
- The source session is never modified. No LLM call is ever made.
- Only user messages are valid boundaries. Assistant, tool, and metadata entries
  are never selectable, which removes every conversation-shape repair concern by
  construction.

## Capabilities

### New Capabilities

- `session-slice`: creating a new Pi session from a user-selected contiguous
  range of the current session's context, including boundary selection, verbatim
  entry preservation, state carry-forward, session switching, and the refusal
  conditions.

### Modified Capabilities

None. This is a greenfield project with no existing specs.

## Impact

- New package: `pi-session-slice` (TypeScript, Pi extension manifest in
  `package.json`).
- Runtime dependencies: Pi's extension API (`registerCommand`, `ctx.ui.custom`,
  `ctx.ui.setEditorText`, `ctx.switchSession`, `ctx.sessionManager` read-only
  surface) and `@earendil-works/pi-tui` for the picker component.
- Writes one new JSONL file per invocation to the session directory of the
  current session. Depends on Pi's session file format (currently version 3);
  the extension refuses to operate on any other version.
- No changes to Pi itself, to the working repository, or to the source session
  file.

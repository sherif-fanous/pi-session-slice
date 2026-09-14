# Agents

## Tasks

[mise](https://mise.jdx.dev/) is the task runner and provisions Node. See
`mise.toml` for the full list. `mise run check` is the pre-commit gate;
`mise run format` and `mise run lint-fix` fix most of what it reports.

## Code conventions

The conventions below are the ones the linter cannot enforce.

### Architecture

- Throw only for I/O failures and programmer errors. Anything a user can
  trigger, such as validation, an unsupported session version, or a missing
  entry, is an expected failure that comes back as a `reason` string, however
  sensible an exception would look at the call site.
- Never open the source session file for writing. The extension reads the
  current session through `ctx.sessionManager` and writes exactly one new file.
  No code path modifies, truncates, or rewrites an existing session.
- Never transform a copied entry. The only field the slice may touch is
  `parentId`, and only where re-chaining the tree requires it. Anything the
  slice adds is a new entry, never a change to an existing one. Do not normalize
  timestamps, strip provider fields, or reorder content, however harmless it
  looks.
- Boundaries are entry ids. The pickers list candidates from the context view;
  the builder slices the raw branch between two ids. Pass ids between them,
  never indexes or copies of entries, so the two lists cannot drift.
- Expose test seams as optional last parameters that default to the real
  implementation, such as the file system on the session file writer. Never
  reach for a DI container or an injection layer to make something testable.
- `slice.ts` is the only module that knows the JSONL format and owns the
  supported session version constant. `index.ts` checks the source header
  against it once, before showing any picker, and refuses on mismatch.

### Comments

Every source file opens with a module JSDoc: one or two sentences saying what
the module does. Every exported function, type, and constant carries a short
JSDoc saying what it does. Do not list what a module is not responsible for, and
do not name sibling modules to disclaim them.

Skip `@param`, `@returns`, and `@throws` tags that restate the signature. Add a
second sentence to a doc block only when the caller needs it: an invariant to
uphold, a non-obvious return contract, a host quirk.

Inline comments are rare. Write one only where the code cannot show the reason
on its own, such as an ordering constraint or a workaround for host behavior.
Delete anything that narrates the next line.

Comments describe the code as it stands today. Never write about what the code
used to do, why it changed, what a change was called, or where it might be
extended later. That history lives in Git and `CHANGELOG.md`.

Comment prose follows the same rules as user-facing text: sentence case,
complete sentences, no em or en dashes, no AI stock vocabulary.

## User-facing text

This is `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, notification and warning
text, overlay bodies, empty states, footer hints, and command descriptions.

Run the `humanizer` and `unslop` skills over anything user-facing and apply what
they report. Without them, at minimum: no em or en dashes, no AI stock
vocabulary, no bold-label lists, active voice, sentence case.

Two audiences. `README.md` and `CHANGELOG.md` are for someone using the
extension: no internal names, event names, or mechanism, because a user cannot
act on `ctx.ui.notify`. `CONTRIBUTING.md` is for someone changing the code, so
technical terms belong there. The prose rules above apply to both.

Prose in notifications, dialog bodies, inline editor notices, warnings, and lead
sentences uses complete sentences with terminal periods. Single-line labels do
not carry one. Picker titles use sentence case, as in `Slice: start at message`
and `Slice: end before message`. Picker rows and secondary lines use concise
text without terminal punctuation, as in `Keep everything to the end` and
`Message 3 of 12 · 2h ago`. Button and footer action labels use Title Case, as
in `Select`, `Cancel`, and `Quit`.

`Pi` is the product, `pi` the binary, and Pi command names stay literal:
`/slice`, `/fork`, `/tree`, `/compact`, `/reload`, `/model`.

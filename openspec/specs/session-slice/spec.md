# session-slice Specification

## Purpose
Lets a user start a new Pi session containing an exact, verbatim range of the current session's conversation, chosen by user-message boundaries, without modifying the original session or calling a model.

## Requirements

### Requirement: Slice command is available
The extension SHALL register a `/slice` command in Pi's interactive mode that starts the slicing flow.

#### Scenario: Command is invoked
- **WHEN** the user runs `/slice` in an idle session that has a session file path and at least one user message in context
- **THEN** the start-boundary picker is shown

### Requirement: Slice refuses to run in unsupported states
The command SHALL refuse to start, display a notification explaining why, and write nothing when preconditions are not met.

#### Scenario: Session has no file path
- **WHEN** `/slice` is run in a session started with `--no-session`, so no session file path exists to switch to
- **THEN** a notification explains that slicing needs a session file and no picker is shown

#### Scenario: Session file not written yet
- **WHEN** `/slice` is run in a persisted session whose file Pi has not written to disk yet because the assistant has not replied
- **THEN** the command proceeds exactly as `/fork` does, recording the assigned path as the parent, and refuses only if there are no user messages

#### Scenario: Agent is busy
- **WHEN** `/slice` is run while the agent is streaming or executing tools
- **THEN** a notification asks the user to wait for the agent to finish and no picker is shown

#### Scenario: No user messages in context
- **WHEN** `/slice` is run and the current context contains no user messages
- **THEN** a notification states there is nothing to slice and no picker is shown

#### Scenario: Unsupported session file version
- **WHEN** `/slice` is run and the source session header declares a version other than the one the extension supports
- **THEN** a notification states the session version is unsupported and no picker is shown

### Requirement: Boundaries are chosen from user messages in current context
Both boundary pickers SHALL list only user messages that are part of the current LLM context view of the current branch, in context order. Entries hidden by an earlier compaction SHALL NOT be listed. User messages retained by the latest compaction SHALL be listed even when their raw entries precede the compaction entry. Assistant, tool-result, bash, custom, and metadata entries SHALL NOT be selectable.

#### Scenario: Branch contains a compaction
- **WHEN** the current branch contains a compaction that retains an earlier user message and is followed by another user message
- **THEN** both retained user messages are listed in context order, messages hidden by the compaction are not listed, and the compaction itself is not listed

#### Scenario: Branch contains non-user entries
- **WHEN** the current context contains assistant messages, tool results, and model-change entries
- **THEN** none of those entries appear in either picker

### Requirement: Start boundary is inclusive
The first picker SHALL select the start boundary. The selected user message SHALL be the first copied entry of the new session. Synthetic state entries MAY precede it.

#### Scenario: Start selected
- **WHEN** the user selects a user message as the start
- **THEN** the end-boundary picker is shown, and the eventual new session begins with that user message

### Requirement: End boundary is exclusive and optional
The second picker SHALL list only user messages that occur after the chosen start, preceded by a default option meaning "keep everything to the end". Selecting a user message SHALL exclude that message and everything after it from the new session.

#### Scenario: Keep to end
- **WHEN** the user accepts the default "keep everything to the end" option
- **THEN** the new session contains the start message and every later entry on the current branch

#### Scenario: End selected
- **WHEN** the user selects a later user message as the end
- **THEN** the new session contains every entry from the start message up to, but not including, the selected end message

#### Scenario: Start is the last user message
- **WHEN** the chosen start is the last user message in context
- **THEN** the end picker offers only the "keep everything to the end" option

### Requirement: Picker rows identify messages
Each picker row SHALL show the message text truncated to one line and a secondary line containing the message's ordinal among listed user messages, the total count, and how long ago the message was sent. Relative times SHALL round to the coarsest applicable unit of seconds, minutes, hours, or days, and SHALL show a short calendar date for messages older than seven days.

#### Scenario: Recent message
- **WHEN** a listed message was sent 130 minutes ago
- **THEN** its secondary line shows "2h ago"

#### Scenario: Old message
- **WHEN** a listed message was sent more than seven days ago
- **THEN** its secondary line shows a short calendar date instead of a relative time

#### Scenario: End row hint
- **WHEN** a user message is listed in the end-boundary picker
- **THEN** its secondary line indicates that its text will be placed in the editor if selected

### Requirement: Cancellation writes nothing
Dismissing either picker SHALL abort the operation. No file SHALL be created and the current session SHALL remain active.

#### Scenario: Escape at start picker
- **WHEN** the user presses Escape in the start-boundary picker
- **THEN** no new session file exists and the current session is unchanged

#### Scenario: Escape at end picker
- **WHEN** the user presses Escape in the end-boundary picker
- **THEN** no new session file exists and the current session is unchanged

### Requirement: Selected entries are preserved verbatim
The new session file SHALL contain every entry of the current branch within the selected range, in the same order, except that label, compaction, and session-info entries SHALL be stripped and the chain re-linked around them. Copied entries SHALL keep the same entry ids, types, timestamps, message roles, tool-call ids, tool names, error flags, and content as the source. The only field that MAY change on a copied entry is its parent reference, and only where re-chaining the start entry or an entry following a stripped label or compaction requires it.

#### Scenario: Range containing a tool loop
- **WHEN** the selected range contains an assistant tool call and its tool result
- **THEN** both entries appear in the new session with the same ids and the tool result still references the same tool-call id

#### Scenario: Range containing extension entries
- **WHEN** the selected range contains custom, custom-message, bash-execution, or branch-summary entries
- **THEN** those entries appear unchanged in the new session

#### Scenario: Labels within range
- **WHEN** an entry within the selected range has a label in the source session
- **THEN** the same label resolves for that entry in the new session

### Requirement: Session state is carried forward
The new session SHALL begin with entries that establish the model and thinking level that were in effect at the start boundary in the source session, so that switching to the new session does not change the active model or thinking level. The new session SHALL NOT inherit the source session's user-defined name.

#### Scenario: Model set before the boundary
- **WHEN** the source session switched to model M before the chosen start and did not switch again
- **THEN** the new session opens with model M active

#### Scenario: Named source session
- **WHEN** the source session has a user-defined name
- **THEN** the new session has no name

#### Scenario: Source renamed inside the selected range
- **WHEN** a session-info entry that names the source occurs after the start boundary
- **THEN** that entry is not copied and the new session has no name

#### Scenario: No prior state entries
- **WHEN** the source session has no model-change or thinking-level entries before the boundary
- **THEN** no synthetic state entries are written for those settings

### Requirement: New session records lineage
The new session file's header SHALL record the source session file as its parent session.

#### Scenario: Parent recorded
- **WHEN** a slice is created from session S
- **THEN** the new session's header names S as its parent session

### Requirement: Pi switches to the new session
After the file is written, the extension SHALL switch Pi to the new session so the user can continue there. When an end boundary was selected, the text of the end message SHALL be placed in the editor.

#### Scenario: Switch after keep-to-end
- **WHEN** the slice is created with the default end option
- **THEN** the new session becomes the active session with an empty editor

#### Scenario: Switch after end selected
- **WHEN** the slice is created with a selected end message
- **THEN** the new session becomes the active session and the editor contains the end message's text

#### Scenario: Success notification
- **WHEN** the switch completes
- **THEN** a notification reports the number of copied range entries, excluding synthetic state and re-emitted label entries

### Requirement: Source session is not modified
The source session file SHALL remain byte-for-byte identical after slicing, regardless of outcome.

#### Scenario: Successful slice
- **WHEN** a slice completes successfully
- **THEN** the source session file content is unchanged

#### Scenario: Failed slice
- **WHEN** writing the new session file fails
- **THEN** the source session file content is unchanged, the current session remains active, and a notification reports the error

### Requirement: No model call
Slicing SHALL NOT send any request to a model provider.

#### Scenario: Slice with no network
- **WHEN** a slice is performed
- **THEN** no provider request is issued during boundary selection, file creation, or session switch

### Requirement: Identical slices are permitted
When the selected range covers the entire current branch, the extension SHALL still create the new session without warning.

#### Scenario: Whole session selected
- **WHEN** the user picks the first user message as start and keeps to the end in a session without compaction
- **THEN** a new session is created containing the same entries as the source

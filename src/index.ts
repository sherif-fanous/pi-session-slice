/** Registers `/slice` and coordinates boundary selection and session switching. */

import { showEndPicker, showStartPicker } from "./picker.js";
import {
  buildSlice,
  listCandidates,
  SUPPORTED_SESSION_VERSION,
  writeSliceFile,
} from "./slice.js";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

/** Run the interactive session-slice flow. */
export async function handleSliceCommand(
  ctx: ExtensionCommandContext,
): Promise<void> {
  // Pi assigns the path at session creation and defers the first write; like
  // /fork, slicing only records the path as parentSession and never reads it.
  const sourcePath = ctx.sessionManager.getSessionFile();

  if (!sourcePath) {
    ctx.ui.notify(
      "Slice needs a session file to switch to. Pi was started with --no-session.",
      "warning",
    );

    return;
  }

  if (!ctx.isIdle()) {
    ctx.ui.notify("Wait for the agent to finish before slicing.", "warning");

    return;
  }

  const header = ctx.sessionManager.getHeader();

  if (header?.version !== SUPPORTED_SESSION_VERSION) {
    ctx.ui.notify(
      `This session uses unsupported format version ${String(header?.version ?? "unknown")}.`,
      "warning",
    );

    return;
  }

  const candidates = listCandidates(ctx.sessionManager);

  if (candidates.length === 0) {
    ctx.ui.notify(
      "This session has no user messages yet, so there is nothing to slice.",
      "warning",
    );

    return;
  }

  const start = await showStartPicker(ctx.ui, candidates);

  if (start.kind !== "message") return;

  const startCandidate = candidates.find(
    (candidate) => candidate.id === start.id,
  );

  if (!startCandidate) {
    ctx.ui.notify(
      "The selected start message is no longer available.",
      "warning",
    );

    return;
  }

  const end = await showEndPicker(ctx.ui, candidates, startCandidate.ordinal);

  if (end.kind === "cancel") return;

  const endId = end.kind === "message" ? end.id : null;
  const endText =
    end.kind === "message"
      ? candidates.find((candidate) => candidate.id === end.id)?.text
      : undefined;
  const result = buildSlice(ctx.sessionManager.getBranch(), start.id, endId);

  if ("reason" in result) {
    ctx.ui.notify(result.reason, "warning");

    return;
  }

  let destination: string;

  try {
    destination = writeSliceFile(
      ctx.sessionManager.getSessionDir(),
      ctx.sessionManager.getCwd(),
      sourcePath,
      result.entries,
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not create the sliced session: ${error instanceof Error ? error.message : String(error)}.`,
      "error",
    );

    return;
  }

  // The original ctx is stale once the switch completes. The ctx passed to
  // withSession belongs to the new session and stays valid, so keep it for the
  // success message, which must come after Pi's own "Resumed session" status
  // or that status replaces it.
  let sliceCtx: ExtensionCommandContext | undefined;

  const switched = await ctx.switchSession(destination, {
    withSession: (newCtx) => {
      sliceCtx = newCtx;

      if (endText !== undefined) newCtx.ui.setEditorText(endText);

      return Promise.resolve();
    },
  });

  if (switched.cancelled) {
    ctx.ui.notify(
      `The sliced session was saved at ${destination}, but Pi did not switch to it.`,
      "warning",
    );

    return;
  }

  sliceCtx?.ui.notify(
    `Sliced ${result.copiedCount} entries into a new session.`,
    "info",
  );
}

/** Register the session-slice command. */
export default function sessionSlice(pi: ExtensionAPI): void {
  pi.registerCommand("slice", {
    description: "Start a new session from a range of this one",
    handler: async (_args, ctx) => handleSliceCommand(ctx),
  });
}

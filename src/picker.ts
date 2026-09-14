/** Renders `/slice` boundary pickers in the style of Pi's `/fork` picker. */

import type { SliceCandidate } from "./slice.js";
import { formatAgo } from "./time.js";
import {
  DynamicBorder,
  type ExtensionUIContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Spacer,
  Text,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

/** Result returned when a boundary picker closes. */
export type PickerResult =
  { kind: "cancel" } | { kind: "end" } | { id: string; kind: "message" };

interface PickerItem {
  candidate?: SliceCandidate;
  result: PickerResult;
  text: string;
}

type PickerMode = "end" | "start";

class MessageList implements Component {
  private readonly maxVisible = 10;
  private selectedIndex: number;

  constructor(
    private readonly items: readonly PickerItem[],
    private readonly mode: PickerMode,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly onDone: (result: PickerResult) => void,
    private readonly startOrdinal?: number,
  ) {
    this.selectedIndex = mode === "end" ? 0 : Math.max(0, items.length - 1);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.items.length - 1
          : this.selectedIndex - 1;
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.items.length - 1
          ? 0
          : this.selectedIndex + 1;
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = this.items[this.selectedIndex];

      if (selected) this.onDone(selected.result);
    } else if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onDone({ kind: "cancel" });
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.items.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = this.items[index];

      if (!item) continue;

      const selected = index === this.selectedIndex;
      const cursor = selected ? this.theme.fg("accent", "› ") : "  ";
      const normalized = item.text.replaceAll("\n", " ").trim();
      const text = truncateToWidth(normalized, Math.max(0, width - 2));

      lines.push(cursor + (selected ? this.theme.bold(text) : text));
      lines.push(this.renderMetadata(item));
      lines.push("");
    }

    if (startIndex > 0 || endIndex < this.items.length) {
      const from =
        this.mode === "end" && this.startOrdinal
          ? ` · from message ${this.startOrdinal}`
          : "";

      lines.push(
        this.theme.fg(
          "muted",
          `  (${this.selectedIndex + 1}/${this.items.length})${from}`,
        ),
      );
    }

    return lines;
  }

  private renderMetadata(item: PickerItem): string {
    if (!item.candidate) {
      return this.theme.fg("muted", "  No end boundary selected");
    }

    const editorHint = this.mode === "end" ? " · goes to your editor" : "";
    const metadata = `  Message ${item.candidate.ordinal} of ${item.candidate.total} · ${formatAgo(item.candidate.timestamp)}${editorHint}`;

    return this.theme.fg("muted", metadata);
  }
}

class MessageSelector extends Container {
  private readonly messageList: MessageList;

  constructor(
    title: string,
    description: string,
    items: readonly PickerItem[],
    mode: PickerMode,
    theme: Theme,
    keybindings: KeybindingsManager,
    onDone: (result: PickerResult) => void,
    startOrdinal?: number,
  ) {
    super();
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.bold(title), 1, 0));
    this.addChild(new Text(theme.fg("muted", description), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((text) => theme.fg("borderMuted", text)));
    this.addChild(new Spacer(1));
    this.messageList = new MessageList(
      items,
      mode,
      theme,
      keybindings,
      onDone,
      startOrdinal,
    );
    this.addChild(this.messageList);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((text) => theme.fg("borderMuted", text)));
  }

  handleInput(data: string): void {
    this.messageList.handleInput(data);
  }
}

/** Show the end boundary picker. */
export async function showEndPicker(
  ui: ExtensionUIContext,
  candidates: readonly SliceCandidate[],
  startOrdinal: number,
): Promise<PickerResult> {
  const afterStart = candidates.filter(
    (candidate) => candidate.ordinal > startOrdinal,
  );
  const items: PickerItem[] = [
    {
      text: "Keep everything to the end",
      result: { kind: "end" },
    },
    ...afterStart.map((candidate) => ({
      candidate,
      text: candidate.text,
      result: { id: candidate.id, kind: "message" } as const,
    })),
  ];

  return showPicker(
    ui,
    "Slice: end before message",
    "Select a message to exclude it and everything after it.",
    items,
    "end",
    startOrdinal,
  );
}

/** Show the inclusive start boundary picker. */
export async function showStartPicker(
  ui: ExtensionUIContext,
  candidates: readonly SliceCandidate[],
): Promise<PickerResult> {
  const items = candidates.map((candidate) => ({
    candidate,
    text: candidate.text,
    result: { id: candidate.id, kind: "message" } as const,
  }));

  return showPicker(
    ui,
    "Slice: start at message",
    "Select the first message to keep in the new session.",
    items,
    "start",
  );
}

async function showPicker(
  ui: ExtensionUIContext,
  title: string,
  description: string,
  items: readonly PickerItem[],
  mode: PickerMode,
  startOrdinal?: number,
): Promise<PickerResult> {
  return ui.custom<PickerResult>(
    (_tui, theme, keybindings, done) =>
      new MessageSelector(
        title,
        description,
        items,
        mode,
        theme,
        keybindings,
        done,
        startOrdinal,
      ),
  );
}

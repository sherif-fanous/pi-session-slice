# pi-session-slice

A [Pi](https://github.com/badlogic/pi) extension that lets you take part of a
conversation into a new session and continue from there.

## Why

A long session can cover several unrelated topics. While working on one project,
you find a bug in another and spend a few turns investigating it. You want to
continue that investigation separately without bringing the rest of the
conversation along or explaining everything again.

`pi-session-slice` copies the part you choose into a new session, including the
replies and tool results. Your original session stays unchanged.

## Install

```shell
pi install npm:@sherif-fanous/pi-session-slice
```

Or try it without installing:

```shell
pi -e npm:@sherif-fanous/pi-session-slice
```

To uninstall:

```shell
pi remove npm:@sherif-fanous/pi-session-slice
```

## Quick start

`/slice` does not work in sessions started with `--no-session`.

1. Run `/slice` when Pi has finished replying.
2. Choose the first message you want to keep.
3. Choose the first message you want to leave out, or select
   `Keep everything to the end`.

Pi opens the new session. If you chose a message to leave out, its text appears
in the editor so you can edit or send it again. Press `Esc` in either picker to
cancel without creating a session.

For example, choosing your third message as the start and your fifth as the end
keeps your third and fourth messages, along with Pi's replies and any tool
activity between them. Your fifth message goes into the editor; it is not part
of the copied conversation.

Use `/resume` to return to the original session. The new session starts without
a name; use `/name` to give it one.

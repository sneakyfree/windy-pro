# User Editing and Paste Behavior

## Transcript Editing

After recording stops, the transcript area becomes **editable**:
- Click anywhere in the transcript to place your cursor
- Select text, delete, retype — standard text editing
- Undo/redo via `Ctrl+Z` / `Ctrl+Shift+Z` (browser native)

**During recording**, editing is locked to prevent cursor interference with live text appends.

When you click **Clear** (🗑️), the transcript resets and editing is disabled until the next recording completes.

## Paste Behavior

When you click **Paste to Cursor** (📝) or press `Ctrl+Shift+V`:

1. The current transcript text is copied to the system clipboard
2. A simulated paste keystroke (`Ctrl+V` / `Cmd+V`) injects it into the active application
3. Post-paste behavior depends on the **"Clear after paste"** setting:

### Clear Mode (ON)
- Transcript area is fully cleared
- Word count resets to 0
- Ready for fresh recording

### Gray Mode (OFF — default)
- Pasted text remains visible but **grayed out** (italic, lighter color)
- The transcript array resets — next recording starts clean
- Grayed text serves as scrollback history
- Editing is disabled (paste = session boundary)

## Settings

Toggle **Clear after paste** in Settings → Simple Mode:
- `ON`: Transcript clears completely after paste
- `OFF`: Pasted text stays visible in gray for reference

## Copy vs Paste

| Button | Action |
|--------|--------|
| **📋 Copy All** | Copies transcript to clipboard (no side effects) |
| **📝 Paste to Cursor** | Injects into active app + clear/gray transition |

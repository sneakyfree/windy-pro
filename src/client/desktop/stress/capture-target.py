#!/usr/bin/env python3
"""
Stress-test capture target. Opens a Tk window that captures keyboard input,
writes the captured text to the file specified in argv[1], and exits after
ARG[2] seconds (default 8).

Uses X11 (under XWayland on Wayland systems) so xdotool can focus it
deterministically. Window title "wstress-target" makes it discoverable.
"""
import sys
import tkinter as tk

if len(sys.argv) < 2:
    print("usage: capture-target.py OUTFILE [TIMEOUT_SEC]", file=sys.stderr)
    sys.exit(2)

outfile = sys.argv[1]
timeout_s = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0

DEBUG_LOG = outfile + ".debug.log"
def dlog(msg):
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(f"{msg}\n")
    except Exception:
        pass

root = tk.Tk()
root.title("wstress-target")
root.geometry("800x300+100+100")
root.attributes("-topmost", True)
root.attributes("-type", "dialog")

txt = tk.Text(root, font=("monospace", 14), wrap="word")
txt.pack(fill="both", expand=True)
txt.focus_set()

dlog(f"started outfile={outfile}")

# Bind Ctrl+Shift+V to paste. Also log every keystroke for diagnostics.
def on_paste_shortcut(e):
    dlog(f"<Control-Shift-V> received state={e.state} keysym={e.keysym}")
    txt.event_generate("<<Paste>>")
    dlog(f"after paste: content_len={len(txt.get('1.0', 'end-1c'))}")
    return "break"
txt.bind("<Control-Shift-v>", on_paste_shortcut)
txt.bind("<Control-Shift-V>", on_paste_shortcut)

# Log all keypresses + releases at BOTH root and widget level, so we catch
# events even if they don't reach the text widget for some reason.
def on_any_keypress(e):
    dlog(f"KeyPress state={e.state} keysym={e.keysym} keycode={e.keycode} char={repr(e.char)}")
def on_any_keyrelease(e):
    dlog(f"KeyRelease state={e.state} keysym={e.keysym} keycode={e.keycode}")
root.bind_all("<KeyPress>", on_any_keypress, add="+")
root.bind_all("<KeyRelease>", on_any_keyrelease, add="+")

# Log focus changes
def on_focus_in(e):  dlog("FocusIn")
def on_focus_out(e): dlog("FocusOut")
root.bind("<FocusIn>", on_focus_in)
root.bind("<FocusOut>", on_focus_out)

# Aggressive focus capture — Mutter on Wayland is reluctant to focus XWayland
# windows. lift() raises in stack, focus_force() demands keyboard focus.
def grab_focus():
    root.lift()
    root.focus_force()
    txt.focus_set()
root.after(50, grab_focus)
root.after(200, grab_focus)
root.after(500, grab_focus)

def finish():
    content = txt.get("1.0", "end-1c")
    try:
        with open(outfile, "w") as f:
            f.write(content)
    except Exception as e:
        print(f"write failed: {e}", file=sys.stderr)
    root.destroy()

root.after(int(timeout_s * 1000), finish)
root.protocol("WM_DELETE_WINDOW", finish)

try:
    root.mainloop()
except KeyboardInterrupt:
    finish()

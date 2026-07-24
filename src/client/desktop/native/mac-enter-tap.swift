// Windy Word — "Send" detector (Stage 7).
//
// Observes the Return / keypad-Enter key across all apps and prints "ENTER".
// Uses an NSEvent GLOBAL monitor — the macOS API built specifically for
// watching events delivered to OTHER applications. It is inherently
// listen-only (cannot consume or modify the event, so it never swallows the
// user's Enter) and we only ever emit on Enter — no other key leaves this
// process. Backed by the Accessibility permission the app already holds.
//
// Reports AX_TRUSTED / AX_UNTRUSTED (is THIS process accessibility-trusted?)
// and MONITOR_READY so the parent can tell "not trusted" apart from "trusted
// but no events". Also requests Input Monitoring as a belt-and-suspenders.

import Cocoa
import ApplicationServices
import IOKit.hid

func emitErr(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

_ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
emitErr(AXIsProcessTrusted() ? "AX_TRUSTED" : "AX_UNTRUSTED")

let RETURN: UInt16 = 36
let KEYPAD_ENTER: UInt16 = 76

let application = NSApplication.shared
application.setActivationPolicy(.accessory) // no Dock icon, no menu bar

// Retain the monitor token for the process lifetime — a discarded return
// value is deallocated by ARC immediately, which REMOVES the monitor.
let monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { (event: NSEvent) in
    if event.keyCode == RETURN || event.keyCode == KEYPAD_ENTER {
        if !event.modifierFlags.contains(.shift) { // Shift+Enter = newline, not send
            FileHandle.standardOutput.write("ENTER\n".data(using: .utf8)!)
        }
    }
}
if monitor == nil { emitErr("MONITOR_NIL") }
emitErr("MONITOR_READY")
application.run()

// Windy Word — "Send" detector (Stage 7).
//
// A LISTEN-ONLY CGEventTap that watches for Return / keypad-Enter and prints
// "ENTER" to stdout. It NEVER consumes or modifies the event (the keystroke
// passes through untouched) and NEVER reports any other key — only Enter ever
// leaves this process, so it can't be a keylogger. The parent (main.js) decides
// whether to fire the effect, scoped to the app the user just pasted into.
//
// Needs the macOS "Input Monitoring" permission. We call IOHIDRequestAccess so
// the system actually PROMPTS the user (and adds the app to the Input Monitoring
// list) the first time — a bare CGEventTap fails silently with no prompt. On
// each launch we report the current grant so the parent can guide the user:
//   PERM_GRANTED / PERM_DENIED / PERM_UNKNOWN, then TAP_READY or TAP_FAILED.

import Cocoa
import CoreGraphics
import IOKit.hid

let RETURN: Int64 = 36
let KEYPAD_ENTER: Int64 = 76

func emitErr(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

// Trigger the Input Monitoring prompt / registration, then report the state.
let requested = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
case kIOHIDAccessTypeGranted: emitErr("PERM_GRANTED")
case kIOHIDAccessTypeDenied:  emitErr("PERM_DENIED")
default:                      emitErr(requested ? "PERM_GRANTED" : "PERM_UNKNOWN")
}

func handle(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .keyDown {
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == RETURN || code == KEYPAD_ENTER {
            if !event.flags.contains(.maskShift) { // Shift+Enter = newline, not send
                FileHandle.standardOutput.write("ENTER\n".data(using: .utf8)!)
            }
        }
    }
    return Unmanaged.passUnretained(event) // pass through, always
}

let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                  place: .headInsertEventTap,
                                  options: .listenOnly,
                                  eventsOfInterest: mask,
                                  callback: handle,
                                  userInfo: nil) else {
    emitErr("TAP_FAILED")
    exit(1)
}
let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emitErr("TAP_READY")
CFRunLoopRun()

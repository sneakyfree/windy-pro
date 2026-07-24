// Windy Word — "Send" detector (Stage 7).
//
// A LISTEN-ONLY CGEventTap that watches for the Return / keypad-Enter key and
// prints "ENTER" to stdout. It NEVER consumes or modifies the event (the
// keystroke passes through untouched — we must never swallow the user's Enter)
// and it NEVER reports any other key: only Enter ever leaves this process, so
// it can't function as a keylogger. The parent (main.js) decides whether to
// fire the effect, scoped to the app the user just pasted into.
//
// Needs Accessibility / Input-Monitoring permission (the app already prompts
// for Accessibility for auto-paste). If the tap can't be created, prints
// TAP_FAILED and exits so the parent can disable the feature cleanly.

import Cocoa
import CoreGraphics

let RETURN: Int64 = 36
let KEYPAD_ENTER: Int64 = 76

func handle(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .keyDown {
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == RETURN || code == KEYPAD_ENTER {
            // Shift+Enter is "newline" in chat apps — only plain Enter is "send".
            if !event.flags.contains(.maskShift) {
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
    FileHandle.standardError.write("TAP_FAILED\n".data(using: .utf8)!)
    exit(1)
}
let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("TAP_READY\n".data(using: .utf8)!)
CFRunLoopRun()

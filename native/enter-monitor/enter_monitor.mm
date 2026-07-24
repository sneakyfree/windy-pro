// Windy Word — Stage 7 "Send" key monitor (native, runs in the MAIN process).
//
// A LISTEN-ONLY CGEventTap. Unlike an NSEvent global monitor (which needs
// AppKit's event-dispatch loop that Electron's main process doesn't service),
// a CGEventTap delivers via a CFRunLoopSource on the main CFRunLoop — which
// Electron DOES pump — so the callback actually fires. It is listen-only: it
// returns every event unmodified and can never consume the user's Enter. It
// only ever forwards the Enter key (keycode + modifiers) to JS; no other key
// leaves this module. All policy (scoping, gestures, firing) lives in JS.

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/hidsystem/IOHIDLib.h>
#import <Carbon/Carbon.h>
#include <napi.h>
#include <pthread.h>

static CFMachPortRef      g_tap = NULL;
static CFRunLoopSourceRef g_src = NULL;
static Napi::ThreadSafeFunction g_tsfn;
static bool g_running = false;
static pthread_t g_thread;
static CFRunLoopRef g_threadLoop = NULL;

static CGEventRef TapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *userInfo) {
  // The system can disable a tap under load — re-enable and move on.
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (g_tap) CGEventTapEnable(g_tap, true);
    return event;
  }
  if (type == kCGEventKeyDown) {
    int64_t kc = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    if (kc == 36 || kc == 76) {            // 36 = Return, 76 = keypad Enter
      CGEventFlags f = CGEventGetFlags(event);
      bool shift = (f & kCGEventFlagMaskShift)     != 0;
      bool cmd   = (f & kCGEventFlagMaskCommand)   != 0;
      bool alt   = (f & kCGEventFlagMaskAlternate) != 0;
      bool ctrl  = (f & kCGEventFlagMaskControl)   != 0;
      if (g_running) {
        g_tsfn.NonBlockingCall([kc, shift, cmd, alt, ctrl](Napi::Env env, Napi::Function jsCb) {
          Napi::Object o = Napi::Object::New(env);
          o.Set("keyCode", Napi::Number::New(env, (double)kc));
          o.Set("shift", Napi::Boolean::New(env, shift));
          o.Set("cmd",   Napi::Boolean::New(env, cmd));
          o.Set("alt",   Napi::Boolean::New(env, alt));
          o.Set("ctrl",  Napi::Boolean::New(env, ctrl));
          jsCb.Call({ o });
        });
      }
    }
  }
  return event;                            // listen-only — always pass through unchanged
}

static void* TapThread(void* arg) {
  @autoreleasepool {
    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown);
    g_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                             kCGEventTapOptionListenOnly, mask, TapCallback, NULL);
    if (!g_tap) { fprintf(stderr, "NATIVE_TAP_CREATE_FAILED\n"); fflush(stderr); g_running = false; return NULL; }
    g_src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
    g_threadLoop = CFRunLoopGetCurrent();
    CFRunLoopAddSource(g_threadLoop, g_src, kCFRunLoopCommonModes);
    CGEventTapEnable(g_tap, true);
    fprintf(stderr, "NATIVE_TAP_THREAD_RUNNING\n"); fflush(stderr);
    CFRunLoopRun();  // blocks here, servicing the tap, until CFRunLoopStop
  }
  return NULL;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_running) return Napi::Boolean::New(env, true);
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) requires a function").ThrowAsJavaScriptException();
    return env.Null();
  }
  g_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "enterMonitor", 0, 1);

  g_running = true;
  // Run the tap on a DEDICATED thread with its own CFRunLoopRun(). Electron's
  // main-process run loop doesn't reliably service an event-tap source (custom
  // mode/pump), so the callback never fired when added to the main loop. A
  // dedicated CFRunLoop is the standard, robust pattern.
  pthread_create(&g_thread, NULL, TapThread, NULL);
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_tap) CGEventTapEnable(g_tap, false);
  if (g_threadLoop) { CFRunLoopStop(g_threadLoop); g_threadLoop = NULL; }
  if (g_running) { pthread_join(g_thread, NULL); }
  if (g_src) { CFRelease(g_src); g_src = NULL; }
  if (g_tap) { CFRelease(g_tap); g_tap = NULL; }
  if (g_running) { g_tsfn.Release(); g_running = false; }
  return env.Undefined();
}

Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), AXIsProcessTrusted());
}
Napi::Value InputMonitoring(const Napi::CallbackInfo& info) {
  IOHIDAccessType t = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
  const char* s = (t == kIOHIDAccessTypeGranted) ? "granted"
                : (t == kIOHIDAccessTypeDenied)  ? "denied" : "unknown";
  return Napi::String::New(info.Env(), s);
}
Napi::Value RequestInputMonitoring(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IOHIDRequestAccess(kIOHIDRequestTypeListenEvent));
}

// Secure Keyboard Entry — when ANY app has it on (Terminal.app's toggle, a
// password field, etc.) macOS hides keystrokes from every tap system-wide.
// Lets us tell the user "Stage 7 can't see Enter here" instead of looking broken.
Napi::Value SecureInputEnabled(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsSecureEventInputEnabled());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("isTrusted", Napi::Function::New(env, IsTrusted));
  exports.Set("inputMonitoring", Napi::Function::New(env, InputMonitoring));
  exports.Set("requestInputMonitoring", Napi::Function::New(env, RequestInputMonitoring));
  exports.Set("secureInputEnabled", Napi::Function::New(env, SecureInputEnabled));
  return exports;
}
NODE_API_MODULE(enter_monitor, Init)

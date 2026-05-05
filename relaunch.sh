#!/bin/bash
# Acquire display env vars from the user's GNOME session
# Find a gnome-shell or gnome-session process to steal env from

get_session_env() {
  for proc in gnome-shell gnome-session-binary nautilus; do
    PID=$(pgrep -u "$(whoami)" "$proc" 2>/dev/null | head -1)
    if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
      echo "Found session env from $proc (PID $PID)" >&2
      cat "/proc/$PID/environ" 2>/dev/null | tr '\0' '\n'
      return 0
    fi
  done
  # Fallback: try any GUI process
  for PID in $(pgrep -u "$(whoami)" 2>/dev/null | head -20); do
    if grep -q "WAYLAND_DISPLAY\|DISPLAY" "/proc/$PID/environ" 2>/dev/null; then
      PROCNAME=$(cat "/proc/$PID/comm" 2>/dev/null)
      echo "Found session env from $PROCNAME (PID $PID)" >&2
      cat "/proc/$PID/environ" 2>/dev/null | tr '\0' '\n'
      return 0
    fi
  done
  echo "Could not find session env" >&2
  return 1
}

SESSION_ENV=$(get_session_env)

if [ -n "$SESSION_ENV" ]; then
  # Extract needed vars
  eval "$(echo "$SESSION_ENV" | grep -E '^(DISPLAY|WAYLAND_DISPLAY|XDG_SESSION_TYPE|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|XDG_CURRENT_DESKTOP)=' | sed 's/^/export /')"
  echo "Display env loaded:"
  echo "  DISPLAY=$DISPLAY"
  echo "  WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
  echo "  XDG_SESSION_TYPE=$XDG_SESSION_TYPE"
  echo "  XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"
  echo "  XDG_CURRENT_DESKTOP=$XDG_CURRENT_DESKTOP"
  echo "  DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
else
  # Hard fallback for common Fedora/GNOME Wayland setup
  echo "Using hard-coded fallback display vars" >&2
  export DISPLAY=:0
  export WAYLAND_DISPLAY=wayland-0
  export XDG_SESSION_TYPE=wayland
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  export XDG_CURRENT_DESKTOP=GNOME
  export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
fi

# Kill old instances
pkill -9 -f electron 2>/dev/null
pkill -9 -f "windy-pro" 2>/dev/null
sleep 1

# Launch
cd "/home/grantwhitmer/Desktop/Grant's Folder/windy-pro"
echo "Launching: electron . --no-sandbox"
echo "CWD: $(pwd)"

"/home/grantwhitmer/Desktop/Grant's Folder/windy-pro/node_modules/electron/dist/electron" . --no-sandbox 2>&1 &
APPPID=$!
echo "PID: $APPPID"

sleep 4
if kill -0 $APPPID 2>/dev/null; then
  echo "✅ App is running"
else
  echo "❌ App crashed"
fi

#!/usr/bin/env bash
# Install Windy Pro systemd user services
# Usage: ./install-services.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$HOME/.config/systemd/user"

echo "═══ Installing Windy Pro systemd user services ═══"

# Create systemd user directory
mkdir -p "$SERVICE_DIR"

# Copy service files
for svc in windy-account-server.service windy-cloud-storage.service; do
  if [ -f "$SCRIPT_DIR/$svc" ]; then
    cp "$SCRIPT_DIR/$svc" "$SERVICE_DIR/$svc"
    echo "✅ Copied $svc → $SERVICE_DIR/"
  else
    echo "⚠️  $svc not found in $SCRIPT_DIR"
  fi
done

# Reload systemd
systemctl --user daemon-reload
echo "✅ systemd daemon reloaded"

# Enable services (start on login)
systemctl --user enable windy-account-server.service 2>/dev/null && echo "✅ Enabled windy-account-server" || echo "⚠️  Could not enable windy-account-server"
systemctl --user enable windy-cloud-storage.service 2>/dev/null && echo "✅ Enabled windy-cloud-storage" || echo "⚠️  Could not enable windy-cloud-storage"

# Start services now
systemctl --user start windy-account-server.service 2>/dev/null && echo "✅ Started windy-account-server (port 8098)" || echo "⚠️  Could not start windy-account-server"
systemctl --user start windy-cloud-storage.service 2>/dev/null && echo "✅ Started windy-cloud-storage (port 8099)" || echo "⚠️  Could not start windy-cloud-storage"

# Enable lingering so services run even when not logged in
loginctl enable-linger "$USER" 2>/dev/null && echo "✅ Enabled lingering for $USER" || echo "⚠️  Could not enable lingering (may need root)"

echo ""
echo "═══ Service Status ═══"
systemctl --user status windy-account-server.service windy-cloud-storage.service --no-pager 2>/dev/null || true

echo ""
echo "═══ Quick Reference ═══"
echo "  Status:  systemctl --user status windy-account-server"
echo "  Logs:    journalctl --user -u windy-account-server -f"
echo "  Stop:    systemctl --user stop windy-account-server"
echo "  Restart: systemctl --user restart windy-account-server"

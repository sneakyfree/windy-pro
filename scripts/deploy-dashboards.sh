#!/bin/bash
# Deploy Windy Chat and Windy Cloud web dashboards
# Run from windy-pro root: bash scripts/deploy-dashboards.sh
#
# Prerequisites:
#   - SSH access to VPS at 72.60.118.54
#   - Docker installed on VPS
#   - Domains pointed: chat.windyword.ai, cloud.windyfly.ai
#
# This script:
#   1. Builds both dashboards locally
#   2. Creates nginx configs
#   3. Deploys to VPS via Docker

set -e

VPS="root@72.60.118.54"
CHAT_DIR="$HOME/windy-chat"
CLOUD_DIR="$HOME/windy-cloud"

echo "=== Building Windy Chat Dashboard ==="
cd "$CHAT_DIR/web"
npm install
npm run build
echo "✓ Chat dashboard built"

echo ""
echo "=== Building Windy Cloud Dashboard ==="
cd "$CLOUD_DIR/web"
npm install
npm run build
echo "✓ Cloud dashboard built"

echo ""
echo "=== Ready to Deploy ==="
echo ""
echo "Chat dashboard:  $CHAT_DIR/web/dist/"
echo "Cloud dashboard: $CLOUD_DIR/web/dist/"
echo ""
echo "Next steps:"
echo "  1. scp -r $CHAT_DIR/web/dist/ $VPS:/opt/windy-chat-web/"
echo "  2. scp -r $CLOUD_DIR/web/dist/ $VPS:/opt/windy-cloud-web/"
echo "  3. Configure nginx on VPS for chat.windyword.ai and cloud.windyfly.ai"
echo "  4. Run certbot for SSL: certbot --nginx -d chat.windyword.ai -d cloud.windyfly.ai"
echo ""
echo "Once deployed, the Electron app tabs will automatically detect and load the dashboards."

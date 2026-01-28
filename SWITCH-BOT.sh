#!/bin/bash
# Quick script to switch from old bot to new production bot
# Run this ON YOUR VULTR SERVER as root

set -e

echo "🔄 Switching to New Production Bot"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root: sudo bash SWITCH-BOT.sh"
  exit 1
fi

# Navigate to project directory
cd /opt/polymarket-bot/poly-sdk || {
  echo "❌ Project directory not found at /opt/polymarket-bot/poly-sdk"
  exit 1
}

echo "📍 Current directory: $(pwd)"
echo ""

# Step 1: Stop old bot
echo "🛑 Step 1: Stopping current bot..."
if systemctl is-active --quiet polymarket-bot; then
  systemctl stop polymarket-bot
  echo "✅ Old bot stopped"
else
  echo "ℹ️  No systemd service running"
fi

# Give it a moment
sleep 2

# Step 2: Check if production-bot.ts exists
echo ""
echo "📦 Step 2: Checking for production-bot.ts..."
if [ ! -f "production-bot.ts" ]; then
  echo "❌ production-bot.ts not found!"
  echo "   Please upload it from your local machine:"
  echo "   scp poly-sdk/production-bot.ts root@$(hostname -I | awk '{print $1}'):/opt/polymarket-bot/poly-sdk/"
  exit 1
fi
echo "✅ production-bot.ts found"

# Step 3: Verify .env file
echo ""
echo "🔐 Step 3: Checking .env file..."
if [ ! -f ".env" ]; then
  echo "❌ .env file not found!"
  echo "   Creating template..."
  echo "PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE" > .env
  chmod 600 .env
  echo "⚠️  Please edit .env and add your real private key:"
  echo "   nano .env"
  exit 1
fi
echo "✅ .env file exists"

# Step 4: Check dependencies
echo ""
echo "📦 Step 4: Checking dependencies..."
if [ ! -d "node_modules" ]; then
  echo "⚠️  node_modules not found. Installing..."
  pnpm install
fi
echo "✅ Dependencies ready"

# Step 5: Update systemd service
echo ""
echo "🔧 Step 5: Updating systemd service..."
cat > /etc/systemd/system/polymarket-bot.service << 'EOF'
[Unit]
Description=Polymarket DipArb Trading Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/polymarket-bot/poly-sdk
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx tsx production-bot.ts
Restart=always
RestartSec=10
StandardOutput=append:/var/log/polymarket-bot.log
StandardError=append:/var/log/polymarket-bot.error.log

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "✅ Service updated"

# Step 6: Start new bot
echo ""
echo "🚀 Step 6: Starting new bot..."
systemctl start polymarket-bot
sleep 2

# Step 7: Check status
echo ""
echo "📊 Step 7: Verifying bot is running..."
if systemctl is-active --quiet polymarket-bot; then
  echo "✅ Bot is running!"
else
  echo "❌ Bot failed to start. Checking logs..."
  journalctl -u polymarket-bot -n 20 --no-pager
  exit 1
fi

echo ""
echo "✅ Migration complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Watch logs: tail -f /var/log/polymarket-bot.log"
echo "  2. Check status: systemctl status polymarket-bot"
echo "  3. View stats: cat bot-stats.json"
echo ""
echo "🎯 The bot will start trading when it detects opportunities."
echo "   This can take 30min - 2 hours depending on market conditions."
echo ""
echo "📖 Read full guide: cat MIGRATION.md"
echo ""

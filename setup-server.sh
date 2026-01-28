#!/bin/bash
# Quick setup script for Vultr deployment
# Run this on your Vultr server as root

set -e

echo "🚀 Polymarket Bot - Automated Setup"
echo "===================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root: sudo bash setup-server.sh"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Node.js 18
echo "📦 Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi

# Install pnpm
echo "📦 Installing pnpm..."
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm
fi

# Verify installations
echo ""
echo "✅ Installed versions:"
node --version
npm --version
pnpm --version

# Create app directory
echo ""
echo "📁 Creating application directory..."
mkdir -p /opt/polymarket-bot
cd /opt/polymarket-bot

# Prompt for setup method
echo ""
echo "Choose setup method:"
echo "1) I'll upload the code manually (using SCP)"
echo "2) Clone from git repository"
read -p "Enter choice (1 or 2): " choice

if [ "$choice" = "2" ]; then
    read -p "Enter git repository URL: " repo_url
    git clone "$repo_url" poly-sdk
    cd poly-sdk
elif [ "$choice" = "1" ]; then
    echo ""
    echo "📤 Upload your poly-sdk folder using SCP:"
    echo "   From your local machine, run:"
    echo "   scp -r /path/to/poly-sdk root@$(hostname -I | awk '{print $1}'):/opt/polymarket-bot/"
    echo ""
    read -p "Press ENTER when upload is complete..."
    
    if [ ! -d "poly-sdk" ]; then
        echo "❌ poly-sdk folder not found in /opt/polymarket-bot/"
        exit 1
    fi
    cd poly-sdk
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install
pnpm build

# Create .env file
echo ""
echo "🔐 Setting up environment..."
if [ ! -f ".env" ]; then
    read -p "Enter your Polygon wallet private key (0x...): " private_key
    echo "PRIVATE_KEY=$private_key" > .env
    chmod 600 .env
    echo "✅ .env file created"
else
    echo "⚠️  .env file already exists, skipping..."
fi

# Get wallet address
echo ""
echo "💼 Your wallet address:"
npx tsx -e "import {ethers} from 'ethers'; const w = new ethers.Wallet(process.env.PRIVATE_KEY); console.log(w.address)" || echo "⚠️  Could not determine address"

# Create systemd service
echo ""
echo "🤖 Creating systemd service..."
cat > /etc/systemd/system/polymarket-bot.service << EOF
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

# Enable service
systemctl daemon-reload
systemctl enable polymarket-bot

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Fund your wallet with $50+ USDC on Polygon network"
echo "2. Verify balance: npx tsx production-bot.ts --check-balance"
echo "3. Start the bot: systemctl start polymarket-bot"
echo "4. Monitor logs: tail -f /var/log/polymarket-bot.log"
echo ""
echo "📊 Commands:"
echo "  Start:   systemctl start polymarket-bot"
echo "  Stop:    systemctl stop polymarket-bot"
echo "  Status:  systemctl status polymarket-bot"
echo "  Logs:    tail -f /var/log/polymarket-bot.log"
echo "  Stats:   cat bot-stats.json"
echo ""
echo "🎯 Read full guide: cat DEPLOYMENT.md"
echo ""

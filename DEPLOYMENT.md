# 🚀 Vultr Server Deployment Guide - Automated Trading Bot

This guide shows you how to deploy the DipArb trading bot on your Vultr server for **24/7 automated profits** with $45 capital.

---

## 📋 Prerequisites

- Vultr server (Ubuntu 20.04+ recommended, $6/month plan is enough)
- $45+ USDC on Polygon network
- Polymarket wallet private key

---

## 🎯 What to Expect

**Strategy**: DipArb (暴跌套利)
- **Capital needed**: $45 minimum
- **Trade size**: $8 per trade (allows 5 concurrent positions)
- **Target profit**: $1-3 per trade (3-5% per round)
- **Frequency**: Low frequency, high certainty (1-5 trades per day)
- **Risk**: Medium (requires market volatility)

**Realistic Expectations**:
- **Good day**: $5-15 profit (2-4 trades)
- **Average day**: $2-5 profit (1-2 trades)
- **Slow day**: $0-2 profit (0-1 trades)
- **Monthly target**: $50-150 profit on $45 capital (100-300% monthly ROI if markets are active)

⚠️ **Important**: This is not guaranteed. Some days you may make $0. The strategy relies on catching panic sells in volatile 15-minute crypto prediction markets.

---

## 🔧 Step 1: Server Setup

### Connect to your Vultr server

```bash
ssh root@your-vultr-ip
```

### Install Node.js 18+

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verify installation
node --version  # Should be v18.x or higher
npm --version
```

### Install pnpm

```bash
npm install -g pnpm
```

---

## 📦 Step 2: Deploy the Bot

### Clone or upload the codebase

```bash
# Create app directory
mkdir -p /opt/polymarket-bot
cd /opt/polymarket-bot

# Upload your poly-sdk folder here
# You can use scp, rsync, or git clone
```

**Using SCP from your local machine**:
```bash
# From your LOCAL machine (not the server)
cd /Users/reza/workspace
scp -r poly-sdk root@your-vultr-ip:/opt/polymarket-bot/
```

### Install dependencies

```bash
cd /opt/polymarket-bot/poly-sdk
pnpm install
pnpm build
```

---

## 🔐 Step 3: Configure Environment

### Create .env file

```bash
cd /opt/polymarket-bot/poly-sdk
nano .env
```

Add your private key:
```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

**Security**: Set proper permissions
```bash
chmod 600 .env
```

### Fund your wallet

1. Get your wallet address:
   ```bash
   # This will show your address
   npx tsx -e "import {ethers} from 'ethers'; const w = new ethers.Wallet(process.env.PRIVATE_KEY); console.log('Address:', w.address)"
   ```

2. Send $50 USDC to this address on **Polygon network** ($45 for trading + $5 for gas/reserve)
   - Use Polymarket's deposit feature, or
   - Bridge from Ethereum using Polygon Bridge, or
   - Send from an exchange that supports Polygon

3. Verify balance:
   ```bash
   npx tsx production-bot.ts --check-balance
   ```

---

## 🤖 Step 4: Set Up 24/7 Service

### Create systemd service

```bash
nano /etc/systemd/system/polymarket-bot.service
```

Paste this configuration:
```ini
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

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Enable and start the service

```bash
# Reload systemd
systemctl daemon-reload

# Enable auto-start on boot
systemctl enable polymarket-bot

# Start the bot
systemctl start polymarket-bot

# Check status
systemctl status polymarket-bot
```

---

## 📊 Step 5: Monitor Your Bot

### View live logs

```bash
# Follow live logs
tail -f /var/log/polymarket-bot.log

# View errors only
tail -f /var/log/polymarket-bot.error.log

# Last 100 lines
tail -n 100 /var/log/polymarket-bot.log
```

### Check statistics

```bash
cd /opt/polymarket-bot/poly-sdk
cat bot-stats.json
```

This shows:
- Total profit/loss
- Number of trades
- Win rate
- Uptime
- Best/worst trades

### Service management

```bash
# Stop the bot
systemctl stop polymarket-bot

# Restart the bot
systemctl restart polymarket-bot

# Check if running
systemctl is-active polymarket-bot

# View service logs
journalctl -u polymarket-bot -f
```

---

## 📈 Understanding the Strategy

### How DipArb Works

1. **Wait for Signal**: Bot monitors 15-min crypto UP/DOWN markets (ETH, BTC, SOL, XRP)
2. **Catch Panic Sells**: When price drops 15%+ in 3 seconds, buy the dip (Leg 1)
3. **Build Hedge**: When opposite side is cheap enough, buy to complete pair (Leg 2)
4. **Lock Profit**: Both sides bought for < $1, market resolves to exactly $1 → profit locked

**Example**:
```
ETH 15-min market: "Will ETH go UP or DOWN?"
- Panic sell: DOWN crashes from $0.55 to $0.40 (-27% in 3s)
- Bot buys: DOWN @ $0.40
- UP price: $0.52
- Total cost: $0.40 + $0.52 = $0.92
- Market resolves to: $1.00
- Profit: $1.00 - $0.92 = $0.08 (8.7% return)
```

### Configuration (in production-bot.ts)

```typescript
const CONFIG = {
  tradeSize: 8,           // $8 per trade
  dipThreshold: 0.15,     // 15% drop triggers signal
  slidingWindowMs: 3000,  // Must drop in 3 seconds
  minProfitRate: 0.03,    // 3% minimum profit required
  sumTarget: 0.95,        // Buy both when total < $0.95
};
```

**⚠️ Don't change these without testing!** They're optimized from backtests.

---

## 💰 Profit Tracking

The bot automatically saves stats to `bot-stats.json`:

```json
{
  "startBalance": 45.00,
  "currentBalance": 52.34,
  "totalTrades": 12,
  "successfulTrades": 10,
  "netProfit": 7.34,
  "totalProfit": 8.50,
  "totalLoss": 1.16,
  "winRate": "83.3%",
  "bestTrade": 2.45,
  "uptime": "72h 15m"
}
```

### Withdraw Profits

When you want to take profits out:

```bash
# Stop the bot first
systemctl stop polymarket-bot

# Use Polymarket's website to withdraw USDC
# Or use the wallet tools in the SDK
```

---

## 🔧 Troubleshooting

### Bot not starting

```bash
# Check logs
journalctl -u polymarket-bot -n 50

# Common issues:
# 1. Missing .env file
# 2. Wrong private key format
# 3. Insufficient balance
# 4. Node modules not installed
```

### Low profit / No trades

This is normal! DipArb is a **low-frequency** strategy. Some days have 0-1 trades.

To check if working:
```bash
# Look for these log messages:
tail -f /var/log/polymarket-bot.log | grep "DIP DETECTED"
```

If you see "DIP DETECTED" but no trades:
- Bot is working, just waiting for profitable opportunities
- Strategy requires total cost < $0.95 to execute
- Most panic sells don't meet this threshold

### Out of memory

If server runs out of RAM:
```bash
# Check memory
free -h

# Restart bot
systemctl restart polymarket-bot
```

### Update the bot code

```bash
# Stop service
systemctl stop polymarket-bot

# Update code
cd /opt/polymarket-bot/poly-sdk
# (upload new code or git pull)

# Rebuild
pnpm install
pnpm build

# Restart
systemctl start polymarket-bot
```

---

## 🛡️ Security Best Practices

1. **Never share your private key**
2. **Use a dedicated wallet** for trading (not your main wallet)
3. **Start with small amounts** ($45-100) to test
4. **Enable firewall**:
   ```bash
   ufw allow 22/tcp  # SSH only
   ufw enable
   ```
5. **Regular backups** of bot-stats.json
6. **Monitor daily** for first week

---

## 📱 Optional: Telegram Notifications

To get profit notifications on your phone, you can modify the bot to send Telegram messages.

1. Create a Telegram bot with @BotFather
2. Get your chat ID
3. Add to production-bot.ts:
   ```typescript
   // Add this function
   async function sendTelegram(message: string) {
     const token = 'YOUR_BOT_TOKEN';
     const chatId = 'YOUR_CHAT_ID';
     await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ chat_id: chatId, text: message }),
     });
   }
   
   // Call it on successful trades:
   sdk.dipArb.on('roundComplete', (result) => {
     if (result.profit > 0) {
       sendTelegram(`🎉 +$${result.profit.toFixed(2)} profit!`);
     }
   });
   ```

---

## ❓ FAQ

**Q: How much can I realistically make?**
A: With $45 capital and $8 trades, expect $50-150/month in active markets. Some months may be slower.

**Q: Can I lose money?**
A: Yes. Failed trades (incomplete hedges) can lose the Leg1 amount (~$8). This is rare but possible.

**Q: How much MATIC do I need for gas?**
A: ~$2 worth of MATIC should last 100+ trades. The bot will warn if MATIC is low.

**Q: Can I increase trade size?**
A: Yes, but keep it proportional to capital. With $100, use $15-20 trades. With $500, use $50-100 trades.

**Q: Will this work forever?**
A: No strategy lasts forever. Market efficiency may reduce opportunities over time. Monitor and adapt.

**Q: Can I run multiple bots?**
A: Yes! Use different wallets and Vultr servers for each bot.

---

## 🎯 Next Steps

1. ✅ Deploy bot following steps above
2. ✅ Fund wallet with $50 USDC on Polygon
3. ✅ Start service and monitor logs
4. ✅ Check stats after 24 hours
5. ✅ Withdraw first profits after 1 week
6. 🚀 Scale up capital once profitable

---

## 📞 Support

- Check logs: `/var/log/polymarket-bot.log`
- View stats: `cat bot-stats.json`
- Read strategy docs: `docs/strategies/dip-arb-strategy.md`

**Good luck! May the dips be ever in your favor! 📈**

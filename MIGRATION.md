# 🔄 Migration Guide - Switch to New Production Bot

This guide helps you replace your current bot with the new optimized DipArb bot.

---

## 📋 Overview

**What we're doing**:
1. Stop your current bot
2. Upload the new bot code
3. Update systemd service
4. Restart with new bot

**Time needed**: 5 minutes  
**Downtime**: ~2 minutes

---

## 🛑 Step 1: Stop Current Bot

SSH into your Vultr server:
```bash
ssh root@YOUR_VULTR_IP
```

Stop the current bot:
```bash
# If you have a systemd service running
systemctl stop polymarket-bot

# Or if running manually, find and kill the process
ps aux | grep -i polymarket
# Then kill the process ID
kill <PID>
```

Verify it's stopped:
```bash
systemctl status polymarket-bot
# Should show "inactive (dead)"
```

---

## 📦 Step 2: Upload New Bot Code

**From your local machine** (not the server):
```bash
cd /Users/reza/workspace
scp poly-sdk/production-bot.ts root@YOUR_VULTR_IP:/opt/polymarket-bot/poly-sdk/
scp poly-sdk/QUICKSTART.md root@YOUR_VULTR_IP:/opt/polymarket-bot/poly-sdk/
scp poly-sdk/DEPLOYMENT.md root@YOUR_VULTR_IP:/opt/polymarket-bot/poly-sdk/
```

---

## 🔐 Step 3: Verify .env File

Back on your **Vultr server**:
```bash
cd /opt/polymarket-bot/poly-sdk
cat .env
```

Should look like:
```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

If it looks good, you're set. If not, edit it:
```bash
nano .env
# Add: PRIVATE_KEY=0xYOUR_KEY
# Save: Ctrl+O, Enter, Ctrl+X
chmod 600 .env
```

---

## 🔧 Step 4: Update Systemd Service

Edit the service file:
```bash
nano /etc/systemd/system/polymarket-bot.service
```

Update the `ExecStart` line to:
```ini
ExecStart=/usr/bin/npx tsx production-bot.ts
```

Full service file should be:
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

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Save and exit (Ctrl+O, Enter, Ctrl+X).

---

## 🚀 Step 5: Start New Bot

Reload systemd and start:
```bash
# Reload systemd to recognize changes
systemctl daemon-reload

# Start the new bot
systemctl start polymarket-bot

# Check status
systemctl status polymarket-bot
```

Should show **"active (running)"** in green.

---

## 📊 Step 6: Verify It's Working

Watch the logs:
```bash
tail -f /var/log/polymarket-bot.log
```

You should see:
```
[2025-01-27...] ℹ️ 🤖 Production DipArb Bot Starting...
[2025-01-27...] ℹ️ Initializing SDK...
[2025-01-27...] ℹ️ 💰 Wallet Status
[2025-01-27...] ℹ️ 🚀 Starting auto-rotation across coins...
[2025-01-27...] ✅ Bot is now running 24/7. Press Ctrl+C to stop.
```

If you see this, **you're good!** 🎉

Press `Ctrl+C` to exit log view (bot keeps running).

---

## 📈 Step 7: Monitor First Trade

Keep watching:
```bash
tail -f /var/log/polymarket-bot.log
```

Wait for a trade signal (can take 30 min - 2 hours):
```
[...] 🎯 DIP DETECTED: DOWN dropped 18.3% in 3s
[...] ✅ LEG1 EXECUTED
[...] 🔄 LEG2 READY: Building hedge position
[...] ✅ LEG2 EXECUTED
[...] 🎉 ROUND COMPLETE: +$2.34 (4.2%)
```

Check stats:
```bash
cat bot-stats.json
```

---

## 🔍 Troubleshooting

### Bot won't start
```bash
# Check error log
tail -n 50 /var/log/polymarket-bot.error.log

# Common fixes:
# 1. Missing dependencies
cd /opt/polymarket-bot/poly-sdk
pnpm install

# 2. Wrong file path
ls -la production-bot.ts
# Should exist

# 3. Restart
systemctl restart polymarket-bot
```

### Bot starts but no trades
**This is normal!** DipArb is low-frequency. Check logs for:
```bash
tail -f /var/log/polymarket-bot.log | grep "DIP DETECTED"
```

If you see "DIP DETECTED" messages, bot is working - just waiting for profitable opportunities.

### "Insufficient balance" error
```bash
# Check balance
cd /opt/polymarket-bot/poly-sdk
npx tsx -e "
import {PolymarketSDK} from './src/index.js';
const sdk = await PolymarketSDK.create({privateKey: process.env.PRIVATE_KEY});
await sdk.tradingService.initialize();
const bal = await sdk.tradingService.getBalances();
console.log('USDC:', bal.usdc);
"
```

If less than $20, add more USDC to your wallet.

### Stats not updating
```bash
# Stats update every 30 minutes or after each trade
# Force check:
cat bot-stats.json

# If file is missing, it will be created after first trade
```

---

## 🎯 What's New in This Bot

Compared to your old bot:

| Feature | Old Bot | New Bot |
|---------|---------|---------|
| **Strategy** | ? | DipArb (proven) |
| **Trade Size** | ? | $8 (configurable) |
| **Auto-restart** | Maybe | Yes (built-in) |
| **Profit tracking** | ? | Yes (bot-stats.json) |
| **Event logging** | ? | Detailed |
| **Multi-coin** | ? | Auto-rotates 4 coins |
| **Risk control** | ? | Max 3 concurrent positions |

---

## ✅ Success Checklist

- [ ] Old bot stopped
- [ ] New code uploaded
- [ ] .env file verified
- [ ] Systemd service updated
- [ ] New bot started successfully
- [ ] Logs show "Bot is now running 24/7"
- [ ] First status update appears (30 min wait)

---

## 🆘 Rollback (If Needed)

If something goes wrong, rollback to your old bot:

```bash
# Stop new bot
systemctl stop polymarket-bot

# Restore old service config
# (You'd need to know your old ExecStart command)
nano /etc/systemd/system/polymarket-bot.service

# Reload and restart
systemctl daemon-reload
systemctl start polymarket-bot
```

---

**You're all set! The new bot is running 24/7.** 💰

Check stats tomorrow:
```bash
cat /opt/polymarket-bot/poly-sdk/bot-stats.json
```

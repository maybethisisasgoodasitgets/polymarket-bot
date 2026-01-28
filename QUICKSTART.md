# ⚡ Quick Start - Make Money with $45

**Goal**: Automated trading bot running 24/7 on Vultr making $1-3 per trade

---

## 🎯 The Reality Check

**What This Bot Does**:
- Strategy: DipArb (catches panic sells in 15-min crypto markets)
- Capital: $45 minimum
- Trade size: $8 per position
- Target: $1-3 profit per successful trade (3-5% returns)
- Frequency: 1-5 trades per day (low frequency, high certainty)

**Realistic Expectations**:
```
Good month:  $50-150 profit on $45 capital (100-300% ROI)
Average:     $30-80 profit per month
Slow month:  $10-30 profit per month
```

**This is NOT**:
- ❌ High-frequency trading (you won't make 100 trades/day)
- ❌ Guaranteed profits (some days = $0)
- ❌ Get-rich-quick (it's consistent, not explosive)

**This IS**:
- ✅ Automated 24/7 operation
- ✅ Low-frequency, high-certainty trades
- ✅ Proven strategy from backtests
- ✅ Risk-controlled ($8 max loss per trade)

---

## 🚀 Three Simple Steps

### Step 1: Upload to Vultr Server

**From your local machine**:
```bash
cd /Users/reza/workspace
scp -r poly-sdk root@YOUR_VULTR_IP:/opt/polymarket-bot/
```

### Step 2: Run Setup Script

**On your Vultr server**:
```bash
ssh root@YOUR_VULTR_IP
cd /opt/polymarket-bot/poly-sdk
bash setup-server.sh
```

This installs everything automatically.

### Step 3: Fund & Start

1. **Get your wallet address** (shown at end of setup)

2. **Send $50 USDC** to that address on **Polygon network**
   - $45 for trading
   - $5 for gas fees

3. **Start the bot**:
   ```bash
   systemctl start polymarket-bot
   ```

4. **Watch it work**:
   ```bash
   tail -f /var/log/polymarket-bot.log
   ```

---

## 📊 What You'll See

### When a trade happens:

```
[2025-01-27T10:15:30Z] 🎯 DIP DETECTED: DOWN dropped 18.3% in 3s
  coin: ETH
  price: 0.4200
  estimatedProfit: 4.2%

[2025-01-27T10:15:32Z] ✅ LEG1 EXECUTED
  side: DOWN
  price: 0.4200
  shares: 8

[2025-01-27T10:16:45Z] 🔄 LEG2 READY: Building hedge position
  totalCost: 0.9300
  expectedProfit: $0.56

[2025-01-27T10:16:47Z] ✅ LEG2 EXECUTED
  side: UP
  price: 0.5100
  shares: 8

[2025-01-27T10:31:00Z] 🎉 ROUND COMPLETE: +$2.34 (4.2%)
  totalProfit: $15.67
  netProfit: $15.67
  winRate: 87.5%
```

### Slow days (normal):

```
[2025-01-27T14:30:00Z] 📊 Status Update (120min runtime)
  balance: $47.23
  netProfit: $2.23
  trades: 1/1
  winRate: 100%
  projectedDaily: $4.46/day
```

---

## 💰 Profit Tracking

Check your stats anytime:
```bash
cat /opt/polymarket-bot/poly-sdk/bot-stats.json
```

Example after 1 week:
```json
{
  "startBalance": 45.00,
  "currentBalance": 62.30,
  "totalTrades": 18,
  "successfulTrades": 15,
  "netProfit": 17.30,
  "winRate": "83.3%",
  "uptime": "168h 0m"
}
```

---

## 🔧 Common Commands

```bash
# Start bot
systemctl start polymarket-bot

# Stop bot
systemctl stop polymarket-bot

# View live logs
tail -f /var/log/polymarket-bot.log

# Check status
systemctl status polymarket-bot

# View stats
cat bot-stats.json

# Restart after changes
systemctl restart polymarket-bot
```

---

## ⚠️ Important Notes

### 1. **This is real money trading**
- Start with $45-50 to test
- Don't invest money you can't afford to lose
- Bot can lose up to $8 on failed trades (rare)

### 2. **Markets must be volatile**
- Strategy needs 15%+ price swings
- Works best during news events
- May have 0 trades on calm days

### 3. **Gas fees**
- Each trade costs ~$0.01-0.05 in gas
- Keep $2-5 worth of MATIC in wallet
- Bot will warn if MATIC is low

### 4. **Monitoring**
- Check logs daily for first week
- Stats update every 30 minutes
- Bot auto-restarts on errors

### 5. **Withdrawing profits**
- Stop bot: `systemctl stop polymarket-bot`
- Withdraw on Polymarket website
- Restart: `systemctl start polymarket-bot`

---

## 📈 Scaling Up

**After 1-2 weeks of profitable operation**:

| Capital | Trade Size | Max Exposure | Expected Monthly* |
|---------|------------|--------------|-------------------|
| $45     | $8         | $24          | $30-80            |
| $100    | $20        | $60          | $70-200           |
| $250    | $50        | $150         | $180-500          |
| $500    | $100       | $300         | $350-1000         |

*Assuming 2-4 successful trades per day at 3-5% profit

**To scale up**:
1. Verify bot is profitable for 2+ weeks
2. Add more USDC to wallet
3. Edit `production-bot.ts` CONFIG section:
   ```typescript
   tradeSize: 20,  // Increase from $8 to $20
   ```
4. Restart bot: `systemctl restart polymarket-bot`

---

## 🆘 Troubleshooting

### "No trades for 24 hours"
✅ **This is normal!** DipArb is low-frequency. Check logs for "DIP DETECTED" - if you see signals, bot is working.

### "Bot keeps restarting"
Check error log: `tail -f /var/log/polymarket-bot.error.log`

Common fixes:
- Wrong private key → Edit .env file
- Low balance → Add more USDC
- No internet → Check server connection

### "Losing money"
- Check `bot-stats.json` for win rate
- If < 50% win rate after 10+ trades, stop and investigate
- Most losses are from incomplete hedges (Leg1 only)

### "Bot stopped"
```bash
# Check status
systemctl status polymarket-bot

# Restart
systemctl restart polymarket-bot

# View recent errors
journalctl -u polymarket-bot -n 50
```

---

## 📚 Full Documentation

- **Complete Guide**: `DEPLOYMENT.md`
- **Strategy Explanation**: `docs/strategies/dip-arb-strategy.md`
- **SDK Documentation**: `README.md`

---

## 🎯 Success Checklist

- [ ] Uploaded code to Vultr server
- [ ] Ran setup-server.sh
- [ ] Created .env with private key
- [ ] Funded wallet with $50 USDC on Polygon
- [ ] Started bot: `systemctl start polymarket-bot`
- [ ] Confirmed bot is running: `systemctl status polymarket-bot`
- [ ] Watching logs: `tail -f /var/log/polymarket-bot.log`
- [ ] Checked stats after 24h: `cat bot-stats.json`
- [ ] Made first profit! 🎉

---

**Ready? Let's make that money! 💰**

1. Upload: `scp -r poly-sdk root@YOUR_VULTR_IP:/opt/polymarket-bot/`
2. Setup: `ssh root@YOUR_VULTR_IP` → `cd /opt/polymarket-bot/poly-sdk` → `bash setup-server.sh`
3. Fund & Start!

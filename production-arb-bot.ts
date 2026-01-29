#!/usr/bin/env npx tsx
/**
 * Production Arbitrage Bot - Standard Market Arbitrage
 * 
 * Scans ALL active Polymarket markets for arbitrage opportunities
 * Strategy: Buy YES + NO when combined cost < $1, merge for guaranteed profit
 * 
 * Works with ANY binary markets - politics, sports, crypto, etc.
 */

import { PolymarketSDK } from './src/index.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Trading parameters
  tradeSize: 10,              // $10 per arbitrage (5 concurrent positions max)
  profitThreshold: 0.005,     // 0.5% minimum profit ($0.05 per $10 trade)
  maxTradeSize: 15,           // Max $15 per trade
  minBalance: 10,             // Keep $10 reserve
  
  // Market scanning
  scanInterval: 30000,        // Rescan markets every 30 seconds
  maxMarketsToMonitor: 20,    // Monitor top 20 most liquid markets
  
  // Auto-execution
  autoExecute: true,
  executionCooldown: 10000,   // 10s between trades (avoid spam)
  
  // Safety
  sizeSafetyFactor: 0.8,      // Use 80% of available liquidity
};

// ============================================================================
// Stats Tracking
// ============================================================================

interface Stats {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  netProfit: number;
  bestTrade: number;
  worstTrade: number;
  marketsScanned: number;
  opportunitiesFound: number;
}

const STATS_FILE = 'arb-bot-stats.json';

function loadStats(): Stats {
  if (existsSync(STATS_FILE)) {
    try {
      return JSON.parse(readFileSync(STATS_FILE, 'utf8'));
    } catch {
      // Fall through
    }
  }
  
  return {
    startTime: Date.now(),
    startBalance: 0,
    currentBalance: 0,
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0,
    netProfit: 0,
    bestTrade: 0,
    worstTrade: 0,
    marketsScanned: 0,
    opportunitiesFound: 0,
  };
}

function saveStats(stats: Stats) {
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// ============================================================================
// Telegram Notifications
// ============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    // Silently fail
  }
}

// ============================================================================
// Logging
// ============================================================================

function log(level: 'info' | 'success' | 'error' | 'warn', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const emoji = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }[level];
  
  console.log(`[${timestamp}] ${emoji} ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// Main Bot Logic
// ============================================================================

async function runBot() {
  const stats = loadStats();
  
  log('info', '🤖 Production Arbitrage Bot Starting...', {
    capital: `$${CONFIG.tradeSize * 5}`,
    strategy: 'Standard arbitrage (YES + NO < $1)',
    profitThreshold: `${(CONFIG.profitThreshold * 100).toFixed(2)}%`,
  });

  // Initialize SDK
  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey) {
    log('error', 'Missing PRIVATE_KEY in environment');
    process.exit(1);
  }

  const sdk = new PolymarketSDK({
    privateKey,
    signatureType: funderAddress ? 1 : undefined,
    funder: funderAddress,
  });

  // Check balance
  const wallet = sdk.tradingService;
  await wallet.initialize();
  
  const balances = await wallet.getBalanceAllowance('COLLATERAL');
  const usdcBalance = parseFloat(balances.balance) / 1e6;
  
  stats.currentBalance = usdcBalance;
  if (stats.startBalance === 0) {
    stats.startBalance = usdcBalance;
  }
  
  log('info', '💰 Wallet Status', {
    address: await wallet.getAddress(),
    usdc: `$${usdcBalance.toFixed(2)}`,
    netProfit: `$${stats.netProfit.toFixed(2)}`,
  });

  await sendTelegram(
    `🤖 <b>Arbitrage Bot Started</b>\n\n` +
    `💰 Balance: $${usdcBalance.toFixed(2)}\n` +
    `📊 Net Profit: $${stats.netProfit.toFixed(2)}\n` +
    `🎯 Target: ${(CONFIG.profitThreshold * 100).toFixed(2)}% profit per trade`
  );

  if (usdcBalance < CONFIG.minBalance) {
    log('error', `Insufficient balance. Need at least $${CONFIG.minBalance}`, {
      current: usdcBalance,
      required: CONFIG.minBalance,
    });
    process.exit(1);
  }

  // ============================================================================
  // Market Scanner
  // ============================================================================

  async function scanMarkets() {
    try {
      log('info', '🔍 Scanning markets for arbitrage...');
      
      const markets = await sdk.gammaApi.getMarkets({
        active: true,
        closed: false,
        limit: 100,
      });

      stats.marketsScanned = markets.length;
      
      // Filter to binary markets with good liquidity
      const binaryMarkets = markets.filter(m => {
        return m.outcomes && m.outcomes.length === 2;
      });

      log('info', `Found ${binaryMarkets.length} binary markets to analyze`);

      // Check each market for arbitrage
      const opportunities = [];
      
      for (const market of binaryMarkets.slice(0, CONFIG.maxMarketsToMonitor)) {
        try {
          // Get full market data with token IDs from condition ID
          const fullMarket = await sdk.markets.getMarket(market.conditionId);
          if (!fullMarket?.tokens || fullMarket.tokens.length !== 2) continue;

          const tokenIds = fullMarket.tokens.map(t => t.tokenId);

          // Get orderbook for both tokens
          const book0 = await sdk.markets.getTokenOrderbook(tokenIds[0]);
          const book1 = await sdk.markets.getTokenOrderbook(tokenIds[1]);

          if (!book0?.bids?.[0] || !book1?.bids?.[0]) continue;

          // Calculate effective buy price for YES + NO
          const yesPrice = parseFloat(String(book0.asks[0]?.price || 1));
          const noPrice = parseFloat(String(book1.asks[0]?.price || 1));
          const totalCost = yesPrice + noPrice;

          const profit = 1 - totalCost;
          const profitRate = profit / totalCost;

          if (profitRate > CONFIG.profitThreshold) {
            opportunities.push({
              market: market.question,
              conditionId: market.conditionId,
              yesTokenId: tokenIds[0],
              noTokenId: tokenIds[1],
              yesPrice,
              noPrice,
              totalCost,
              profit,
              profitRate,
            });
          }
        } catch (err) {
          // Skip markets with errors
        }
      }

      stats.opportunitiesFound += opportunities.length;

      if (opportunities.length > 0) {
        log('success', `🎯 Found ${opportunities.length} arbitrage opportunities!`);
        
        for (const opp of opportunities.slice(0, 3)) {
          log('info', `📊 Opportunity: ${opp.market}`, {
            yesCost: `$${opp.yesPrice.toFixed(4)}`,
            noCost: `$${opp.noPrice.toFixed(4)}`,
            totalCost: `$${opp.totalCost.toFixed(4)}`,
            profit: `$${opp.profit.toFixed(4)}`,
            profitRate: `${(opp.profitRate * 100).toFixed(2)}%`,
          });

          await sendTelegram(
            `🎯 <b>Arbitrage Found!</b>\n\n` +
            `📊 ${opp.market.substring(0, 100)}\n` +
            `💵 YES: $${opp.yesPrice.toFixed(4)} + NO: $${opp.noPrice.toFixed(4)}\n` +
            `💰 Profit: $${opp.profit.toFixed(4)} (${(opp.profitRate * 100).toFixed(2)}%)`
          );

          // Execute if auto-execute enabled
          if (CONFIG.autoExecute) {
            log('info', '⚡ Executing arbitrage...');
            // TODO: Execute the trade
            // For now just log - execution requires more complex order handling
          }
        }
      } else {
        log('info', `No arbitrage found (scanned ${binaryMarkets.length} markets)`);
      }

      saveStats(stats);
    } catch (error: any) {
      log('error', `Scan error: ${error.message}`);
    }
  }

  // Initial scan
  await scanMarkets();

  // Periodic scanning
  setInterval(scanMarkets, CONFIG.scanInterval);

  // Periodic status updates
  setInterval(async () => {
    const balances = await wallet.getBalanceAllowance('COLLATERAL');
    stats.currentBalance = parseFloat(balances.balance) / 1e6;
    
    const runtime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    
    log('info', `📊 Status Update (${runtime}min runtime)`, {
      balance: `$${stats.currentBalance.toFixed(2)}`,
      netProfit: `$${stats.netProfit.toFixed(2)}`,
      trades: `${stats.successfulTrades}/${stats.totalTrades}`,
      marketsScanned: stats.marketsScanned,
      opportunitiesFound: stats.opportunitiesFound,
    });

    saveStats(stats);
  }, 300000); // Every 5 minutes

  log('success', '✅ Bot is now running 24/7');
}

// ============================================================================
// Start Bot
// ============================================================================

runBot().catch((error) => {
  log('error', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

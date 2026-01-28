#!/usr/bin/env npx tsx
/**
 * Production DipArb Bot - 24/7 Automated Trading
 * 
 * Optimized for small capital ($45) with $5-10 trades
 * Runs continuously on server, auto-restarts on errors
 * 
 * Strategy: DipArb (暴跌套利)
 * - Catches panic sells in 15-min UP/DOWN markets
 * - Buys dips, hedges with opposite side when profitable
 * - Targets 3-5% profit per round
 * 
 * Setup:
 *   1. Create .env file with PRIVATE_KEY=your_key
 *   2. Fund wallet with $45+ USDC on Polygon
 *   3. Run: npx tsx production-bot.ts
 * 
 * For Vultr deployment, see: DEPLOYMENT.md
 */

import { PolymarketSDK } from './src/index.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Trading parameters (conservative for $45 capital)
  tradeSize: 8,              // $8 per trade (allows 5 concurrent positions)
  minProfitRate: 0.03,       // 3% minimum profit
  sumTarget: 0.95,           // Buy both sides when total cost < $0.95
  
  // Signal detection (proven parameters from backtests)
  dipThreshold: 0.15,        // 15% drop in 3 seconds
  slidingWindowMs: 3000,     // 3-second window (CRITICAL)
  windowMinutes: 2,          // Only trade first 2 mins of round
  
  // Safety limits
  maxConcurrentPositions: 3, // Max 3 open positions ($24 max exposure)
  minBalance: 10,            // Keep $10 reserve for gas/emergencies
  
  // Auto-rotation
  coins: ['ETH', 'BTC', 'SOL', 'XRP'],
  preferDuration: '15m' as const,
  
  // Operational
  autoExecute: true,
  autoMerge: true,
  settleStrategy: 'sell' as const,
  logLevel: 'info' as const,
};

// ============================================================================
// Profit Tracking
// ============================================================================

interface Stats {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  bestTrade: number;
  worstTrade: number;
  lastUpdate: number;
  uptime: number;
  restarts: number;
}

const STATS_FILE = 'bot-stats.json';

function loadStats(): Stats {
  if (existsSync(STATS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
      return { ...data, uptime: Date.now() - data.startTime };
    } catch {
      // Fall through to create new stats
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
    totalLoss: 0,
    netProfit: 0,
    bestTrade: 0,
    worstTrade: 0,
    lastUpdate: Date.now(),
    uptime: 0,
    restarts: 0,
  };
}

function saveStats(stats: Stats) {
  stats.lastUpdate = Date.now();
  stats.uptime = Date.now() - stats.startTime;
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
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
  stats.restarts++;
  
  log('info', '🤖 Production DipArb Bot Starting...', {
    capital: `$${CONFIG.tradeSize * CONFIG.maxConcurrentPositions}`,
    strategy: 'DipArb (15% drops in 3s)',
    coins: CONFIG.coins.join(', '),
    session: stats.restarts,
  });

  // Validate environment
  const privateKey = process.env.PRIVATE_KEY || process.env.POLY_PRIVKEY;
  if (!privateKey) {
    log('error', 'Missing PRIVATE_KEY in environment');
    process.exit(1);
  }

  // Initialize SDK with proxy wallet configuration
  const funderAddress = process.env.FUNDER_ADDRESS;
  const sdk = new PolymarketSDK({
    privateKey,
    signatureType: funderAddress ? 1 : undefined, // POLY_PROXY if funder specified
    funder: funderAddress, // Your proxy wallet address (optional)
  });

  // Check initial balance
  try {
    const wallet = sdk.tradingService;
    await wallet.initialize();
    
    const balances = await wallet.getBalanceAllowance('COLLATERAL');
    const usdcBalance = parseFloat(balances.balance);
    
    if (stats.startBalance === 0) {
      stats.startBalance = usdcBalance;
    }
    stats.currentBalance = usdcBalance;
    
    log('info', '💰 Wallet Status', {
      address: await wallet.getAddress(),
      usdc: `$${usdcBalance.toFixed(2)}`,
      netProfit: `$${stats.netProfit.toFixed(2)}`,
      roi: stats.startBalance > 0 ? `${((stats.netProfit / stats.startBalance) * 100).toFixed(2)}%` : '0%',
    });

    if (usdcBalance < CONFIG.minBalance) {
      log('error', `Insufficient balance. Need at least $${CONFIG.minBalance}`, {
        current: usdcBalance,
        required: CONFIG.minBalance,
      });
      process.exit(1);
    }

    if (usdcBalance < CONFIG.tradeSize + CONFIG.minBalance) {
      log('warn', 'Low balance. Reducing trade size to $5');
      CONFIG.tradeSize = 5;
    }

  } catch (error: any) {
    log('error', 'Failed to check wallet balance', error.message);
    throw error;
  }

  // Configure DipArb service
  sdk.dipArb.updateConfig({
    shares: CONFIG.tradeSize,
    sumTarget: CONFIG.sumTarget,
    minProfitRate: CONFIG.minProfitRate,
    dipThreshold: CONFIG.dipThreshold,
    slidingWindowMs: CONFIG.slidingWindowMs,
    windowMinutes: CONFIG.windowMinutes,
    autoExecute: CONFIG.autoExecute,
    autoMerge: CONFIG.autoMerge,
  });

  // ============================================================================
  // Event Handlers
  // ============================================================================

  sdk.dipArb.on('signal', (signal) => {
    if (signal.type === 'leg1') {
      log('info', `🎯 DIP DETECTED: ${signal.dipSide} dropped ${(signal.dropPercent * 100).toFixed(1)}% in 3s`, {
        coin: signal.coin,
        price: signal.currentPrice.toFixed(4),
        estimatedProfit: `${(signal.estimatedProfitRate * 100).toFixed(1)}%`,
      });
    } else if (signal.type === 'leg2') {
      log('info', `🔄 LEG2 READY: Building hedge position`, {
        totalCost: signal.totalCost?.toFixed(4),
        expectedProfit: `$${signal.expectedProfit?.toFixed(2)}`,
      });
    }
  });

  sdk.dipArb.on('execution', (result) => {
    if (result.success) {
      log('success', `✅ ${result.leg.toUpperCase()} EXECUTED`, {
        side: result.side,
        price: result.price?.toFixed(4),
        shares: result.shares,
      });
    } else {
      log('error', `❌ ${result.leg.toUpperCase()} FAILED: ${result.error}`);
      stats.failedTrades++;
      saveStats(stats);
    }
  });

  sdk.dipArb.on('roundComplete', (result) => {
    const profit = result.profit || 0;
    const profitPercent = result.profitRate ? result.profitRate * 100 : 0;
    
    stats.totalTrades++;
    if (profit > 0) {
      stats.successfulTrades++;
      stats.totalProfit += profit;
      stats.netProfit += profit;
      if (profit > stats.bestTrade) stats.bestTrade = profit;
      
      log('success', `🎉 ROUND COMPLETE: +$${profit.toFixed(2)} (${profitPercent.toFixed(1)}%)`, {
        totalProfit: `$${stats.totalProfit.toFixed(2)}`,
        netProfit: `$${stats.netProfit.toFixed(2)}`,
        winRate: `${((stats.successfulTrades / stats.totalTrades) * 100).toFixed(1)}%`,
      });
    } else {
      const loss = Math.abs(profit);
      stats.totalLoss += loss;
      stats.netProfit -= loss;
      if (profit < stats.worstTrade) stats.worstTrade = profit;
      
      log('warn', `📉 ROUND LOSS: -$${loss.toFixed(2)}`, {
        reason: result.status,
        netProfit: `$${stats.netProfit.toFixed(2)}`,
      });
    }
    
    saveStats(stats);
  });

  sdk.dipArb.on('roundRotate', (event) => {
    log('info', `🔄 Rotating to new market`, {
      coin: event.coin,
      round: event.round,
    });
  });

  sdk.dipArb.on('error', (error) => {
    log('error', `Error in DipArb service: ${error.message}`);
  });

  // ============================================================================
  // Start Trading
  // ============================================================================

  log('info', '🚀 Starting auto-rotation across coins...', {
    coins: CONFIG.coins,
    duration: CONFIG.preferDuration,
  });

  try {
    await sdk.dipArb.enableAutoRotate({
      underlyings: CONFIG.coins,
      preferDuration: CONFIG.preferDuration,
      settleStrategy: CONFIG.settleStrategy,
    });

    log('success', '✅ Bot is now running 24/7. Press Ctrl+C to stop.');
    
  } catch (error: any) {
    log('error', 'Failed to start auto-rotation', error.message);
    throw error;
  }

  // ============================================================================
  // Periodic Status Updates
  // ============================================================================

  setInterval(async () => {
    try {
      const balances = await sdk.tradingService.getBalanceAllowance('COLLATERAL');
      stats.currentBalance = parseFloat(balances.balance);
      
      const runtime = Math.floor((Date.now() - stats.startTime) / 1000 / 60); // minutes
      const hourlyRate = stats.netProfit / (runtime / 60);
      const dailyProjection = hourlyRate * 24;
      
      log('info', `📊 Status Update (${runtime}min runtime)`, {
        balance: `$${stats.currentBalance.toFixed(2)}`,
        netProfit: `$${stats.netProfit.toFixed(2)}`,
        trades: `${stats.successfulTrades}/${stats.totalTrades}`,
        winRate: stats.totalTrades > 0 ? `${((stats.successfulTrades / stats.totalTrades) * 100).toFixed(1)}%` : '0%',
        projectedDaily: `$${dailyProjection.toFixed(2)}/day`,
      });
      
      saveStats(stats);
    } catch (error: any) {
      log('warn', 'Failed to update status', error.message);
    }
  }, 30 * 60 * 1000); // Every 30 minutes

  // ============================================================================
  // Graceful Shutdown
  // ============================================================================

  async function shutdown() {
    log('info', '🛑 Shutting down gracefully...');
    
    try {
      await sdk.dipArb.stop();
      saveStats(stats);
      
      log('info', '📊 Final Statistics', {
        runtime: `${Math.floor(stats.uptime / 1000 / 60 / 60)}h ${Math.floor((stats.uptime / 1000 / 60) % 60)}m`,
        totalTrades: stats.totalTrades,
        successful: stats.successfulTrades,
        winRate: stats.totalTrades > 0 ? `${((stats.successfulTrades / stats.totalTrades) * 100).toFixed(1)}%` : '0%',
        totalProfit: `$${stats.totalProfit.toFixed(2)}`,
        totalLoss: `$${stats.totalLoss.toFixed(2)}`,
        netProfit: `$${stats.netProfit.toFixed(2)}`,
        bestTrade: `$${stats.bestTrade.toFixed(2)}`,
        worstTrade: `$${stats.worstTrade.toFixed(2)}`,
      });
      
      process.exit(0);
    } catch (error: any) {
      log('error', 'Error during shutdown', error.message);
      process.exit(1);
    }
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ============================================================================
// Auto-Restart on Errors
// ============================================================================

async function main() {
  let attempt = 0;
  const maxAttempts = 100; // Allow 100 restarts before giving up
  
  while (attempt < maxAttempts) {
    try {
      await runBot();
      // If runBot completes normally, exit
      break;
    } catch (error: any) {
      attempt++;
      log('error', `Bot crashed (attempt ${attempt}/${maxAttempts})`, {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      });
      
      if (attempt < maxAttempts) {
        const delaySeconds = Math.min(60, attempt * 10); // Exponential backoff up to 60s
        log('info', `⏳ Restarting in ${delaySeconds} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      } else {
        log('error', 'Max restart attempts reached. Exiting.');
        process.exit(1);
      }
    }
  }
}

main().catch((error) => {
  log('error', 'Fatal error', error);
  process.exit(1);
});

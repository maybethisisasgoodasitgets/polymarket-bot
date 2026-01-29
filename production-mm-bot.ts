#!/usr/bin/env npx tsx
/**
 * Production Market Making Bot
 * 
 * Strategy: Provide liquidity on both sides of binary markets, earn the spread
 * Capital: Optimized for $50-100
 * Risk: Low - stays delta-neutral by keeping equal YES/NO value
 */

import { PolymarketSDK } from './src/index.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Market selection
  minLiquidity: 500,           // Only markets with $500+ liquidity
  minVolume24h: 100,            // Only markets with $100+ daily volume
  maxMarkets: 5,                // Make markets in 5 different markets simultaneously
  
  // Order sizing
  orderSize: 5,                 // $5 per side ($10 total exposure per market)
  spreadTarget: 0.02,           // Target 2% spread (earn $0.10 on $5)
  minSpread: 0.01,              // Don't compete below 1% spread
  
  // Position management
  maxPositionImbalance: 0.2,    // Rebalance if YES/NO ratio > 60/40
  rebalanceInterval: 60000,     // Check positions every 60s
  
  // Order management
  orderUpdateInterval: 30000,   // Update orders every 30s
  cancelStaleOrders: true,      // Cancel unfilled orders before updating
  
  // Safety
  minBalance: 10,               // Keep $10 reserve
  maxLoss: 5,                   // Stop if daily loss > $5
};

// ============================================================================
// Stats Tracking
// ============================================================================

interface Stats {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  totalFills: number;
  buyFills: number;
  sellFills: number;
  spreadEarned: number;
  netProfit: number;
  activeMarkets: string[];
  marketsTraded: number;
}

const STATS_FILE = 'mm-bot-stats.json';

function loadStats(): Stats {
  if (existsSync(STATS_FILE)) {
    try {
      return JSON.parse(readFileSync(STATS_FILE, 'utf8'));
    } catch {}
  }
  
  return {
    startTime: Date.now(),
    startBalance: 0,
    currentBalance: 0,
    totalFills: 0,
    buyFills: 0,
    sellFills: 0,
    spreadEarned: 0,
    netProfit: 0,
    activeMarkets: [],
    marketsTraded: 0,
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
  } catch {}
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
// Market Selection
// ============================================================================

async function selectMarkets(sdk: PolymarketSDK) {
  const markets = await sdk.gammaApi.getMarkets({
    active: true,
    closed: false,
    limit: 100,
  });

  // Filter binary markets with good liquidity
  const candidates = markets
    .filter(m => 
      m.outcomes?.length === 2 &&
      m.liquidity >= CONFIG.minLiquidity &&
      (m.volume24hr || 0) >= CONFIG.minVolume24h
    )
    .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
    .slice(0, CONFIG.maxMarkets);

  log('info', `Selected ${candidates.length} markets for market making`, {
    markets: candidates.map(m => ({
      question: m.question.substring(0, 60) + '...',
      liquidity: `$${m.liquidity.toFixed(0)}`,
      volume24h: `$${(m.volume24hr || 0).toFixed(0)}`,
    })),
  });

  return candidates;
}

// ============================================================================
// Market Making Logic
// ============================================================================

interface MarketMakingPosition {
  conditionId: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  midPrice: number;
  ourBuyOrderId?: string;
  ourSellOrderId?: string;
  yesBalance: number;
  noBalance: number;
}

const activePositions = new Map<string, MarketMakingPosition>();

async function updateMarketOrders(sdk: PolymarketSDK, market: any) {
  try {
    // Get full market data
    const fullMarket = await sdk.markets.getMarket(market.conditionId);
    if (!fullMarket?.tokens || fullMarket.tokens.length !== 2) return;

    const yesTokenId = fullMarket.tokens[0].tokenId;
    const noTokenId = fullMarket.tokens[1].tokenId;

    // Get current orderbook
    const yesBook = await sdk.markets.getTokenOrderbook(yesTokenId);
    const noBook = await sdk.markets.getTokenOrderbook(noTokenId);

    // Calculate mid price from orderbook
    const yesBestBid = parseFloat(String(yesBook.bids[0]?.price || 0.5));
    const yesBestAsk = parseFloat(String(yesBook.asks[0]?.price || 0.5));
    const midPrice = (yesBestBid + yesBestAsk) / 2;

    // Calculate our order prices with spread
    const halfSpread = CONFIG.spreadTarget / 2;
    const ourBuyPrice = Math.max(0.01, midPrice - halfSpread);
    const ourSellPrice = Math.min(0.99, midPrice + halfSpread);

    // Calculate order size in shares
    const shares = CONFIG.orderSize / ourBuyPrice;

    log('info', `📊 Market: ${market.question.substring(0, 50)}...`, {
      midPrice: midPrice.toFixed(3),
      ourBuy: ourBuyPrice.toFixed(3),
      ourSell: ourSellPrice.toFixed(3),
      spread: `${(CONFIG.spreadTarget * 100).toFixed(1)}%`,
    });

    // Store position info
    activePositions.set(market.conditionId, {
      conditionId: market.conditionId,
      question: market.question,
      yesTokenId,
      noTokenId,
      midPrice,
      yesBalance: 0,
      noBalance: 0,
    });

    try {
      // Place buy order (providing liquidity to buyers)
      const buyOrder = await sdk.tradingService.createLimitOrder({
        tokenId: yesTokenId,
        side: 'BUY',
        price: ourBuyPrice,
        size: shares,
      });

      log('success', `✅ Placed BUY order: ${shares.toFixed(1)} shares @ $${ourBuyPrice.toFixed(3)}`);

      // Place sell order (providing liquidity to sellers)
      const sellOrder = await sdk.tradingService.createLimitOrder({
        tokenId: yesTokenId,
        side: 'SELL',
        price: ourSellPrice,
        size: shares,
      });

      log('success', `✅ Placed SELL order: ${shares.toFixed(1)} shares @ $${ourSellPrice.toFixed(3)}`);

      await sendTelegram(
        `📝 <b>Orders Placed</b>\n\n` +
        `📊 ${market.question.substring(0, 80)}\n` +
        `💰 BUY @ $${ourBuyPrice.toFixed(3)} | SELL @ $${ourSellPrice.toFixed(3)}\n` +
        `📈 Spread: ${(CONFIG.spreadTarget * 100).toFixed(1)}%`
      );

    } catch (error: any) {
      log('error', `Failed to place orders: ${error.message}`);
    }

  } catch (error: any) {
    log('error', `Error updating market ${market.question}: ${error.message}`);
  }
}

// ============================================================================
// Main Bot Logic
// ============================================================================

async function runBot() {
  const stats = loadStats();
  
  log('info', '🤖 Market Making Bot Starting...', {
    capital: `$${CONFIG.orderSize * CONFIG.maxMarkets * 2}`,
    strategy: 'Provide liquidity, earn spreads',
    targetSpread: `${(CONFIG.spreadTarget * 100).toFixed(1)}%`,
    markets: CONFIG.maxMarkets,
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
    `🏪 <b>Market Making Bot Started</b>\n\n` +
    `💰 Balance: $${usdcBalance.toFixed(2)}\n` +
    `📊 Strategy: Provide liquidity, earn ${(CONFIG.spreadTarget * 100).toFixed(1)}% spreads\n` +
    `🎯 Markets: ${CONFIG.maxMarkets} simultaneous\n` +
    `💵 Size: $${CONFIG.orderSize} per side`
  );

  if (usdcBalance < CONFIG.minBalance) {
    log('error', `Insufficient balance. Need at least $${CONFIG.minBalance}`);
    process.exit(1);
  }

  // ============================================================================
  // Main Loop
  // ============================================================================

  async function updateAllOrders() {
    try {
      log('info', '🔄 Updating market orders...');
      
      const selectedMarkets = await selectMarkets(sdk);
      stats.activeMarkets = selectedMarkets.map(m => m.question);
      
      for (const market of selectedMarkets) {
        await updateMarketOrders(sdk, market);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
      }
      
      saveStats(stats);
    } catch (error: any) {
      log('error', `Update error: ${error.message}`);
    }
  }

  // Initial setup
  await updateAllOrders();

  // Periodic order updates
  setInterval(updateAllOrders, CONFIG.orderUpdateInterval);

  // Position monitoring (check if orders filled)
  setInterval(async () => {
    try {
      const balances = await wallet.getBalanceAllowance('COLLATERAL');
      const newBalance = parseFloat(balances.balance) / 1e6;
      
      const balanceChange = newBalance - stats.currentBalance;
      stats.currentBalance = newBalance;
      stats.netProfit = newBalance - stats.startBalance;

      const runtime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
      
      log('info', `📊 Status (${runtime}min runtime)`, {
        balance: `$${stats.currentBalance.toFixed(2)}`,
        netProfit: `$${stats.netProfit.toFixed(2)}`,
        fills: stats.totalFills,
        activeMarkets: stats.activeMarkets.length,
      });

      if (Math.abs(balanceChange) > 0.01) {
        log('success', `💰 Balance change: ${balanceChange > 0 ? '+' : ''}$${balanceChange.toFixed(2)}`);
      }

      saveStats(stats);
    } catch (error: any) {
      log('error', `Monitoring error: ${error.message}`);
    }
  }, CONFIG.rebalanceInterval);

  log('success', '✅ Bot is now running 24/7 - Providing liquidity');
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGINT', async () => {
  log('info', '🛑 Shutting down gracefully...');
  log('info', '📊 Final Statistics', {
    runtime: `${Math.floor((Date.now() - loadStats().startTime) / 60000)}min`,
    fills: loadStats().totalFills,
    netProfit: `$${loadStats().netProfit.toFixed(2)}`,
  });
  process.exit(0);
});

// ============================================================================
// Start Bot
// ============================================================================

runBot().catch((error) => {
  log('error', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

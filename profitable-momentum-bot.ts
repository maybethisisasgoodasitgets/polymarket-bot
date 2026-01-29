#!/usr/bin/env npx tsx
/**
 * Profitable Momentum Bot V2
 * Built for $35 capital with strict risk management
 * 
 * Strategy: Conservative momentum following with quality market filters
 * Goal: Steady $1-3/week profit
 */

import { PolymarketSDK } from './src/index.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ============================================================================
// CONFIGURATION - Conservative Settings
// ============================================================================

const CONFIG = {
  // Position sizing
  positionSize: 1,          // $1 per trade (33 trades available)
  maxDailyLoss: 3,          // Stop bot if lose $3 in a day
  
  // Market quality filters (STRICT)
  minPrice: 0.30,           // 30¢ minimum (avoid penny stocks)
  maxPrice: 0.70,           // 70¢ maximum (avoid extremes)
  minVolume24h: 50000,      // $50K+ daily volume
  minLiquidity: 100000,     // $100K+ liquidity
  
  // Entry criteria
  momentumThreshold: 0.04,  // 4% price move required
  timeWindow: 300000,       // 5 minute window
  
  // Exit criteria
  takeProfitPct: 0.08,      // 8% profit target
  stopLossPct: 0.03,        // 3% stop loss
  
  // Safety
  tradeCooldown: 3600000,   // 1 hour between trades
  checkInterval: 300000,    // Check every 5 minutes
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

interface PriceData {
  price: number;
  timestamp: number;
}

interface Position {
  marketId: string;
  marketName: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  amount: number;
  timestamp: number;
}

interface BotState {
  priceHistory: Map<string, PriceData[]>;
  currentPosition: Position | null;
  lastTradeTime: number;
  dailyPnL: number;
  dailyResetTime: number;
  totalTrades: number;
  winningTrades: number;
}

const state: BotState = {
  priceHistory: new Map(),
  currentPosition: null,
  lastTradeTime: 0,
  dailyPnL: 0,
  dailyResetTime: Date.now(),
  totalTrades: 0,
  winningTrades: 0,
};

// ============================================================================
// TELEGRAM
// ============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, 
        text: message, 
        parse_mode: 'HTML' 
      }),
    });
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

// ============================================================================
// LOGGING
// ============================================================================

function log(level: 'INFO' | 'SUCCESS' | 'ERROR' | 'WARN', msg: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const emoji = { INFO: 'ℹ️', SUCCESS: '✅', ERROR: '❌', WARN: '⚠️' }[level];
  console.log(`[${timestamp}] ${emoji} ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

// ============================================================================
// MARKET QUALITY FILTER
// ============================================================================

function isQualityMarket(market: any): boolean {
  // Must be binary
  if (!market.outcomes || market.outcomes.length !== 2) {
    return false;
  }

  // Price must be in range (30-70¢)
  const price = market.outcomePrices[0];
  if (price < CONFIG.minPrice || price > CONFIG.maxPrice) {
    return false;
  }

  // Volume check
  if ((market.volume24hr || 0) < CONFIG.minVolume24h) {
    return false;
  }

  // Liquidity check
  if (market.liquidity < CONFIG.minLiquidity) {
    return false;
  }

  return true;
}

// ============================================================================
// MOMENTUM DETECTION
// ============================================================================

function detectMomentum(marketId: string, currentPrice: number): { 
  hasMomentum: boolean; 
  direction: 'UP' | 'DOWN' | null;
  changePercent: number;
} {
  const history = state.priceHistory.get(marketId) || [];
  
  if (history.length < 2) {
    return { hasMomentum: false, direction: null, changePercent: 0 };
  }

  // Get price from 5 minutes ago
  const oldestPrice = history[0].price;
  const priceChange = (currentPrice - oldestPrice) / oldestPrice;
  const absChange = Math.abs(priceChange);

  if (absChange >= CONFIG.momentumThreshold) {
    return {
      hasMomentum: true,
      direction: priceChange > 0 ? 'UP' : 'DOWN',
      changePercent: priceChange * 100,
    };
  }

  return { hasMomentum: false, direction: null, changePercent: 0 };
}

// ============================================================================
// POSITION MANAGEMENT
// ============================================================================

function shouldTrade(): boolean {
  // Already in position
  if (state.currentPosition !== null) {
    return false;
  }

  // Too soon since last trade (cooldown)
  if (Date.now() - state.lastTradeTime < CONFIG.tradeCooldown) {
    return false;
  }

  // Daily loss limit hit
  if (state.dailyPnL <= -CONFIG.maxDailyLoss) {
    log('WARN', `Daily loss limit hit: $${state.dailyPnL.toFixed(2)}`);
    return false;
  }

  return true;
}

async function enterPosition(
  sdk: PolymarketSDK,
  market: any,
  direction: 'UP' | 'DOWN',
  changePercent: number
): Promise<void> {
  try {
    const fullMarket = await sdk.markets.getMarket(market.conditionId);
    if (!fullMarket?.tokens || fullMarket.tokens.length !== 2) {
      log('ERROR', 'Invalid market structure');
      return;
    }

    const tokenId = fullMarket.tokens[0].tokenId;
    const side = direction === 'UP' ? 'BUY' : 'SELL';
    const entryPrice = market.outcomePrices[0];

    log('INFO', `Entering ${side} position`, {
      market: market.question.substring(0, 60),
      price: entryPrice.toFixed(3),
      momentum: `${changePercent.toFixed(1)}%`,
      amount: `$${CONFIG.positionSize}`,
    });

    // Execute market order
    await sdk.tradingService.createMarketOrder({
      tokenId,
      side,
      amount: CONFIG.positionSize,
    });

    // Record position
    state.currentPosition = {
      marketId: market.conditionId,
      marketName: market.question,
      tokenId,
      side,
      entryPrice,
      amount: CONFIG.positionSize,
      timestamp: Date.now(),
    };

    state.lastTradeTime = Date.now();
    state.totalTrades++;

    await sendTelegram(
      `🚀 <b>Position Opened</b>\n\n` +
      `📊 ${market.question.substring(0, 70)}\n` +
      `💵 ${side} @ $${entryPrice.toFixed(3)}\n` +
      `📈 Momentum: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%\n` +
      `🎯 Target: +${(CONFIG.takeProfitPct * 100).toFixed(0)}% | Stop: -${(CONFIG.stopLossPct * 100).toFixed(0)}%`
    );

    log('SUCCESS', 'Position opened successfully');
  } catch (error: any) {
    log('ERROR', `Failed to enter position: ${error.message}`);
  }
}

async function checkPosition(sdk: PolymarketSDK): Promise<void> {
  if (!state.currentPosition) return;

  try {
    const book = await sdk.markets.getTokenOrderbook(state.currentPosition.tokenId);
    const currentPrice = parseFloat(String(book.bids[0]?.price || state.currentPosition.entryPrice));
    
    const pnlPct = (currentPrice - state.currentPosition.entryPrice) / state.currentPosition.entryPrice;
    const pnlAmount = state.currentPosition.amount * pnlPct;

    // Check exit conditions
    const shouldTakeProfit = pnlPct >= CONFIG.takeProfitPct;
    const shouldStopLoss = pnlPct <= -CONFIG.stopLossPct;

    if (shouldTakeProfit || shouldStopLoss) {
      const reason = shouldTakeProfit ? 'TAKE PROFIT' : 'STOP LOSS';
      
      log('INFO', `Exiting position: ${reason}`, {
        pnl: `${(pnlPct * 100).toFixed(1)}%`,
        amount: `$${pnlAmount.toFixed(2)}`,
      });

      // Sell position
      const sellAmount = state.currentPosition.amount * (currentPrice / state.currentPosition.entryPrice);
      await sdk.tradingService.createMarketOrder({
        tokenId: state.currentPosition.tokenId,
        side: state.currentPosition.side === 'BUY' ? 'SELL' : 'BUY',
        amount: sellAmount,
      });

      // Update stats
      state.dailyPnL += pnlAmount;
      if (pnlAmount > 0) state.winningTrades++;

      await sendTelegram(
        `${pnlAmount > 0 ? '✅' : '❌'} <b>${reason}</b>\n\n` +
        `📊 ${state.currentPosition.marketName.substring(0, 60)}\n` +
        `💰 P/L: ${pnlAmount > 0 ? '+' : ''}$${pnlAmount.toFixed(2)} (${(pnlPct * 100).toFixed(1)}%)\n` +
        `📈 Today: ${state.dailyPnL > 0 ? '+' : ''}$${state.dailyPnL.toFixed(2)}\n` +
        `🎯 Win Rate: ${state.totalTrades > 0 ? ((state.winningTrades / state.totalTrades) * 100).toFixed(0) : 0}%`
      );

      log('SUCCESS', 'Position closed');
      state.currentPosition = null;
    }
  } catch (error: any) {
    log('ERROR', `Error checking position: ${error.message}`);
  }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function mainLoop(sdk: PolymarketSDK): Promise<void> {
  try {
    // Reset daily P/L at midnight
    if (Date.now() - state.dailyResetTime > 86400000) {
      state.dailyPnL = 0;
      state.dailyResetTime = Date.now();
    }

    // Check existing position first
    if (state.currentPosition) {
      await checkPosition(sdk);
      return; // Don't look for new trades while in position
    }

    // Fetch quality markets
    const markets = await sdk.gammaApi.getMarkets({
      active: true,
      closed: false,
      limit: 100,
    });

    const qualityMarkets = markets.filter(isQualityMarket);
    
    log('INFO', `Monitoring ${qualityMarkets.length} quality markets`);

    // Update price history and detect momentum
    for (const market of qualityMarkets) {
      const marketId = market.conditionId;
      const currentPrice = market.outcomePrices[0];

      // Update price history
      if (!state.priceHistory.has(marketId)) {
        state.priceHistory.set(marketId, []);
      }
      
      const history = state.priceHistory.get(marketId)!;
      history.push({ price: currentPrice, timestamp: Date.now() });

      // Keep only 10 minutes of data
      const cutoff = Date.now() - 600000;
      state.priceHistory.set(
        marketId,
        history.filter(p => p.timestamp > cutoff)
      );

      // Detect momentum
      const momentum = detectMomentum(marketId, currentPrice);

      if (momentum.hasMomentum && shouldTrade()) {
        log('SUCCESS', `🎯 MOMENTUM DETECTED`, {
          market: market.question.substring(0, 60),
          change: `${momentum.changePercent.toFixed(1)}%`,
          direction: momentum.direction,
        });

        await enterPosition(sdk, market, momentum.direction!, momentum.changePercent);
        break; // Only one trade per cycle
      }
    }

  } catch (error: any) {
    log('ERROR', `Main loop error: ${error.message}`);
  }
}

// ============================================================================
// START BOT
// ============================================================================

async function startBot(): Promise<void> {
  log('INFO', '🚀 Profitable Momentum Bot V2 Starting');
  log('INFO', 'Configuration', {
    positionSize: `$${CONFIG.positionSize}`,
    priceRange: `${(CONFIG.minPrice * 100).toFixed(0)}¢-${(CONFIG.maxPrice * 100).toFixed(0)}¢`,
    momentum: `${(CONFIG.momentumThreshold * 100).toFixed(0)}%`,
    takeProfit: `+${(CONFIG.takeProfitPct * 100).toFixed(0)}%`,
    stopLoss: `-${(CONFIG.stopLossPct * 100).toFixed(0)}%`,
  });

  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey) {
    log('ERROR', 'Missing PRIVATE_KEY in environment');
    process.exit(1);
  }

  const sdk = new PolymarketSDK({
    privateKey,
    signatureType: funderAddress ? 1 : undefined,
    funder: funderAddress,
  });

  await sdk.tradingService.initialize();

  const balances = await sdk.tradingService.getBalanceAllowance('COLLATERAL');
  const balance = parseFloat(balances.balance) / 1e6;

  log('INFO', `💰 Balance: $${balance.toFixed(2)}`);

  await sendTelegram(
    `💰 <b>Momentum Bot V2 Started</b>\n\n` +
    `💵 Balance: $${balance.toFixed(2)}\n` +
    `📊 Position: $${CONFIG.positionSize} per trade\n` +
    `🎯 Quality markets only (${(CONFIG.minPrice * 100).toFixed(0)}-${(CONFIG.maxPrice * 100).toFixed(0)}¢)`
  );

  // Run initial check
  await mainLoop(sdk);

  // Schedule checks every 5 minutes
  setInterval(() => mainLoop(sdk), CONFIG.checkInterval);

  log('SUCCESS', '✅ Bot running - monitoring for momentum');
}

startBot().catch(error => {
  log('ERROR', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

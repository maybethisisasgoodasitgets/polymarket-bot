#!/usr/bin/env npx tsx
/**
 * Momentum Trading Bot - Optimized for $35 capital
 * 
 * Strategy: Detect 5%+ price moves in 5 min, follow momentum
 * Position: $2 per trade
 * Exit: +10% profit or -5% stop loss
 */

import { PolymarketSDK } from './src/index.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// Config
const CONFIG = {
  positionSize: 2,        // $2 per trade
  momentumThreshold: 0.05, // 5% price move
  takeProfitPct: 0.10,     // 10% profit target
  stopLossPct: 0.05,       // 5% max loss
  checkInterval: 300000,   // Check every 5 minutes
  maxDailyLoss: 5,         // Stop if lose $5 in a day
};

interface PriceHistory {
  [marketId: string]: {
    price: number;
    timestamp: number;
  }[];
}

interface Position {
  marketId: string;
  marketName: string;
  tokenId: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  shares: number;
  timestamp: number;
}

const priceHistory: PriceHistory = {};
let currentPosition: Position | null = null;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

function log(msg: string, data?: any) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

async function runBot() {
  log('🚀 Momentum Bot Starting', {
    capital: '$35',
    positionSize: `$${CONFIG.positionSize}`,
    momentum: `${CONFIG.momentumThreshold * 100}%`,
    takeProfit: `${CONFIG.takeProfitPct * 100}%`,
    stopLoss: `${CONFIG.stopLossPct * 100}%`,
  });

  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;
  
  if (!privateKey) {
    log('❌ Missing PRIVATE_KEY');
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
  
  log('💰 Balance', { usdc: `$${balance.toFixed(2)}` });

  await sendTelegram(
    `⚡ <b>Momentum Bot Started</b>\n\n` +
    `💰 Balance: $${balance.toFixed(2)}\n` +
    `📊 Strategy: Follow 5%+ price moves\n` +
    `💵 Position: $${CONFIG.positionSize} per trade`
  );

  async function checkMarkets() {
    try {
      const markets = await sdk.gammaApi.getMarkets({
        active: true,
        closed: false,
        limit: 50,
      });

      const topMarkets = markets
        .filter(m => m.outcomes?.length === 2 && (m.volume24hr || 0) > 10000)
        .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
        .slice(0, 5);

      log(`📊 Monitoring ${topMarkets.length} markets`);

      for (const market of topMarkets) {
        const currentPrice = market.outcomePrices[0];
        const marketId = market.conditionId;

        if (!priceHistory[marketId]) {
          priceHistory[marketId] = [];
        }

        priceHistory[marketId].push({
          price: currentPrice,
          timestamp: Date.now(),
        });

        // Keep only last 10 minutes of data
        priceHistory[marketId] = priceHistory[marketId].filter(
          p => Date.now() - p.timestamp < 600000
        );

        if (priceHistory[marketId].length >= 2) {
          const oldPrice = priceHistory[marketId][0].price;
          const priceChange = (currentPrice - oldPrice) / oldPrice;

          if (Math.abs(priceChange) >= CONFIG.momentumThreshold && !currentPosition) {
            log(`🎯 MOMENTUM DETECTED: ${market.question}`, {
              oldPrice: oldPrice.toFixed(3),
              newPrice: currentPrice.toFixed(3),
              change: `${(priceChange * 100).toFixed(1)}%`,
            });

            await sendTelegram(
              `🎯 <b>Momentum Signal</b>\n\n` +
              `📊 ${market.question.substring(0, 80)}\n` +
              `📈 Price: ${oldPrice.toFixed(3)} → ${currentPrice.toFixed(3)}\n` +
              `💹 Change: ${(priceChange * 100).toFixed(1)}%`
            );

            // Enter position - follow momentum direction
            try {
              const fullMarket = await sdk.markets.getMarket(marketId);
              if (!fullMarket?.tokens || fullMarket.tokens.length !== 2) continue;

              const tokenId = fullMarket.tokens[0].tokenId;
              const side = priceChange > 0 ? 'BUY' : 'SELL';
              
              const order = await sdk.tradingService.createMarketOrder({
                tokenId,
                side,
                amount: CONFIG.positionSize,
              });

              const shares = CONFIG.positionSize / currentPrice;

              currentPosition = {
                marketId,
                marketName: market.question,
                tokenId,
                side: priceChange > 0 ? 'YES' : 'NO',
                entryPrice: currentPrice,
                shares,
                timestamp: Date.now(),
              };

              log('✅ Position entered', currentPosition);

              await sendTelegram(
                `✅ <b>Position Opened</b>\n\n` +
                `📊 ${market.question.substring(0, 60)}\n` +
                `💵 ${side} ${shares.toFixed(1)} shares @ $${currentPrice.toFixed(3)}\n` +
                `🎯 Target: +${(CONFIG.takeProfitPct * 100).toFixed(0)}% | Stop: -${(CONFIG.stopLossPct * 100).toFixed(0)}%`
              );

            } catch (error: any) {
              log(`❌ Failed to enter: ${error.message}`);
            }
          }
        }
      }

      // Check existing position for exit
      if (currentPosition) {
        try {
          const book = await sdk.markets.getTokenOrderbook(currentPosition.tokenId);
          const currentPrice = parseFloat(String(book.bids[0]?.price || currentPosition.entryPrice));
          const pnlPct = (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice;

          if (pnlPct >= CONFIG.takeProfitPct || pnlPct <= -CONFIG.stopLossPct) {
            const reason = pnlPct >= CONFIG.takeProfitPct ? 'TAKE PROFIT' : 'STOP LOSS';
            const pnlAmount = currentPosition.shares * (currentPrice - currentPosition.entryPrice);
            
            log(`🎯 ${reason}`, {
              pnl: `${(pnlPct * 100).toFixed(1)}%`,
              amount: `$${pnlAmount.toFixed(2)}`,
            });

            // Sell position
            const sellAmount = currentPosition.shares * currentPrice;
            await sdk.tradingService.createMarketOrder({
              tokenId: currentPosition.tokenId,
              side: 'SELL',
              amount: sellAmount,
            });

            await sendTelegram(
              `${pnlPct > 0 ? '✅' : '❌'} <b>${reason}</b>\n\n` +
              `📊 ${currentPosition.marketName.substring(0, 60)}\n` +
              `💰 P/L: ${pnlPct > 0 ? '+' : ''}$${pnlAmount.toFixed(2)} (${(pnlPct * 100).toFixed(1)}%)`
            );

            currentPosition = null;
          }
        } catch (error: any) {
          log(`❌ Error checking position: ${error.message}`);
        }
      }

    } catch (error: any) {
      log(`❌ Error: ${error.message}`);
    }
  }

  // Run initial check
  await checkMarkets();

  // Check every 5 minutes
  setInterval(checkMarkets, CONFIG.checkInterval);

  log('✅ Bot running - monitoring for momentum signals');
}

runBot().catch(error => {
  log(`❌ Fatal: ${error.message}`);
  process.exit(1);
});

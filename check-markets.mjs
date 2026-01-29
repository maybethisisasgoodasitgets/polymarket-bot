import { PolymarketSDK } from './src/index.js';

const sdk = await PolymarketSDK.create();

console.log('Fetching all active markets...\n');
const allMarkets = await sdk.gammaApi.getMarkets({ 
  closed: false,
  active: true,
  limit: 100 
});

console.log(`Total active markets: ${allMarkets.length}\n`);

// Check for 15-minute markets
const fifteenMin = allMarkets.filter(m => m.question?.match(/15.?min/i));
console.log(`15-minute markets: ${fifteenMin.length}`);
fifteenMin.slice(0, 5).forEach(m => console.log('  -', m.question));

// Check for UP/DOWN markets
const upDown = allMarkets.filter(m => m.question?.match(/\b(UP|DOWN)\b/));
console.log(`\nUP/DOWN markets: ${upDown.length}`);
upDown.slice(0, 5).forEach(m => console.log('  -', m.question));

// Check for crypto markets
const crypto = allMarkets.filter(m => 
  m.question?.match(/(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana|Ripple|crypto)/i)
);
console.log(`\nCrypto-related markets: ${crypto.length}`);
crypto.slice(0, 10).forEach(m => console.log('  -', m.question));

// Show sample of any active markets
console.log(`\nSample of active markets:`);
allMarkets.slice(0, 10).forEach(m => console.log('  -', m.question));

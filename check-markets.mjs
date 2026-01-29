import { PolymarketSDK } from './src/index.js';

const sdk = await PolymarketSDK.create();
const markets = await sdk.gammaApi.getMarkets({ closed: false });

const cryptoMarkets = markets.filter(m => 
  m.question?.includes('15-minute') && 
  (m.question?.includes('BTC') || m.question?.includes('ETH') || 
   m.question?.includes('SOL') || m.question?.includes('XRP'))
);

console.log(`Found ${cryptoMarkets.length} active 15-min crypto markets`);
cryptoMarkets.slice(0, 10).forEach(m => console.log('-', m.question));

if (cryptoMarkets.length === 0) {
  console.log('\n⚠️  No 15-minute markets found!');
  console.log('Checking for any crypto markets...\n');
  
  const anyCrypto = markets.filter(m =>
    m.question?.match(/(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana|Ripple)/i)
  );
  
  console.log(`Found ${anyCrypto.length} total crypto markets`);
  anyCrypto.slice(0, 10).forEach(m => console.log('-', m.question));
}

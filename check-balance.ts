#!/usr/bin/env npx tsx
/**
 * Check wallet and Polymarket balances
 */

import { PolymarketSDK } from './src/index.js';
import { ethers } from 'ethers';

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY not found in environment');
    process.exit(1);
  }

  console.log('\n🔍 Checking balances...\n');

  // Initialize SDK
  const sdk = await PolymarketSDK.create({ privateKey });
  await sdk.tradingService.initialize();

  // Check wallet USDC balance on Polygon
  const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
  const wallet = new ethers.Wallet(privateKey, provider);
  const usdcContract = new ethers.Contract(
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
    ['function balanceOf(address) view returns (uint256)'],
    provider
  );
  const walletBalance = await usdcContract.balanceOf(wallet.address);
  const walletUSDC = parseFloat(ethers.utils.formatUnits(walletBalance, 6));

  // Check Polymarket CLOB balance
  const clobBalance = await sdk.tradingService.getBalanceAllowance('COLLATERAL');
  const clobUSDC = parseFloat(clobBalance.balance);

  // Display results
  console.log('📍 Wallet Address:', wallet.address);
  console.log('');
  console.log('💵 Polygon Wallet Balance:', walletUSDC.toFixed(2), 'USDC');
  console.log('🏦 Polymarket CLOB Balance:', clobUSDC.toFixed(2), 'USDC');
  console.log('');

  if (walletUSDC > 0 && clobUSDC === 0) {
    console.log('⚠️  You have USDC in your wallet but $0 on Polymarket!');
    console.log('');
    console.log('📝 Action needed:');
    console.log('   1. Go to https://polymarket.com');
    console.log('   2. Connect your wallet');
    console.log('   3. Deposit USDC to Polymarket');
    console.log('   4. Wait for confirmation (~1-2 min)');
    console.log('   5. Run this script again to verify');
    console.log('');
  } else if (clobUSDC > 0) {
    console.log('✅ Ready to trade! You have $' + clobUSDC.toFixed(2) + ' on Polymarket.');
    console.log('');
  } else {
    console.log('❌ No USDC found in wallet or Polymarket.');
    console.log('   Send USDC to:', wallet.address);
    console.log('   Network: Polygon (MATIC)');
    console.log('');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

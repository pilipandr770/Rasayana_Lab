require('dotenv').config();
const { ethers } = require('ethers');
async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const bal = await provider.getBalance(process.env.DEPLOYER_ADDRESS);
  console.log('Balance:', ethers.formatEther(bal), 'ETH');
}
main();

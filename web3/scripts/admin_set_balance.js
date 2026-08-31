// Использование: TARGET=0x... AMOUNT=100 npx hardhat run scripts/admin_set_balance.js --network sepolia
const hre = require("hardhat");

async function main() {
  const to = process.env.TARGET;
  const amount = process.env.AMOUNT;
  if (!to || !to.startsWith("0x")) throw new Error("Укажи TARGET=0x...");
  if (!amount) throw new Error("Укажи AMOUNT=100");

  const address = "0x36Da05224E9D98e9f4008f487466802F4f8701FE";
  const contract = await hre.ethers.getContractAt("RasayanaMembership", address);

  const tx = await contract.adminSetBalance(to, amount);
  await tx.wait();
  console.log(`Баланс ${to} установлен:`, (await contract.balanceOf(to)).toString());
  console.log("Уровень (tierOf):", (await contract.tierOf(to)).toString());
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

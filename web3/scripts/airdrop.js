// Использование: npx hardhat run scripts/airdrop.js --network sepolia -- 0xАдресПолучателя
const hre = require("hardhat");

async function main() {
  const to = process.env.AIRDROP_TO || process.argv[process.argv.length - 1];
  if (!to || !to.startsWith("0x")) {
    throw new Error("Укажи адрес получателя последним аргументом");
  }
  const address = "0x36Da05224E9D98e9f4008f487466802F4f8701FE";
  const contract = await hre.ethers.getContractAt("RasayanaMembership", address);

  const already = await contract.hasClaimedFree(to);
  if (already) {
    console.log(`${to} уже получал бесплатный токен, баланс:`, (await contract.balanceOf(to)).toString());
    return;
  }

  const tx = await contract.airdrop(to);
  await tx.wait();
  console.log(`Airdrop готов. Баланс ${to}:`, (await contract.balanceOf(to)).toString());
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

// Использование: TO=0x... AMOUNT=0.01 npx hardhat run scripts/send_eth.js --network sepolia
const hre = require("hardhat");

async function main() {
  const to = process.env.TO;
  const amount = process.env.AMOUNT || "0.01";
  if (!to || !to.startsWith("0x")) throw new Error("Укажи TO=0x...");

  const [signer] = await hre.ethers.getSigners();
  const tx = await signer.sendTransaction({
    to,
    value: hre.ethers.parseEther(amount),
  });
  await tx.wait();
  console.log(`Отправлено ${amount} test ETH на ${to}. Tx: ${tx.hash}`);
  const bal = await hre.ethers.provider.getBalance(to);
  console.log(`Новый баланс получателя: ${hre.ethers.formatEther(bal)} ETH`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

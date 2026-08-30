const hre = require("hardhat");

async function main() {
  const address = "0xFEa77eAf7bE46ec845801eAE93dE6d156e223d49";
  const contract = await hre.ethers.getContractAt("RasayanaMembership", address);
  const [signer] = await hre.ethers.getSigners();

  console.log("Wallet:", signer.address);

  let tx = await contract.claimFree();
  await tx.wait();
  console.log("claimFree() ok, balance:", (await contract.balanceOf(signer.address)).toString());

  const quote = await contract.quoteCost(signer.address, 4);
  console.log("Cost to buy 4 more tokens (wei):", quote.toString());

  tx = await contract.buy(4, { value: quote });
  await tx.wait();

  const bal = await contract.balanceOf(signer.address);
  const tier = await contract.tierOf(signer.address);
  const discount = await contract.discountBps(signer.address);
  console.log("After buy(4): balance =", bal.toString(), " tier =", tier.toString(), " discountBps =", discount.toString());
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

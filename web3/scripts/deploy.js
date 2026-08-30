const hre = require("hardhat");

async function main() {
  const Membership = await hre.ethers.getContractFactory("RasayanaMembership");
  const membership = await Membership.deploy();
  await membership.waitForDeployment();
  const address = await membership.getAddress();
  console.log("RasayanaMembership deployed to:", address);

  const deployTx = membership.deploymentTransaction();
  console.log("Deployment tx hash:", deployTx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

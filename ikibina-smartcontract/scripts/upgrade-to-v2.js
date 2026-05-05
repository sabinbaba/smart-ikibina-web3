// scripts/upgrade-to-v2.js
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Upgrading IkiminaV1 to IkiminaV2...");
  
  const PROXY_ADDRESS = "0x04D16753355413F83272E4a53406D3C8564f1593";
  
  const IkiminaV2 = await ethers.getContractFactory("IkiminaV2");
  
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, IkiminaV2);
  
  await upgraded.waitForDeployment();
  
  console.log("✅ Upgrade complete!");
  console.log("Proxy still at:", PROXY_ADDRESS);
  console.log("New implementation deployed!");
}

main().catch(console.error);
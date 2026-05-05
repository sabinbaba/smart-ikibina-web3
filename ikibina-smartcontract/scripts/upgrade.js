// scripts/upgrade.js
// Usage: npx hardhat run scripts/upgrade.js --network sepolia

const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENTS_DIR = path.join(__dirname, "../deployments");
const DEPLOYMENTS_FILE = path.join(DEPLOYMENTS_DIR, "deployments.json");

function loadDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_FILE)) return {};
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
}

function saveDeployments(data) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  console.log("─".repeat(52));
  console.log("  Ikimina – Upgrade Script");
  console.log("─".repeat(52));

  const [deployer] = await ethers.getSigners();
  const netName = network.name;
  
  console.log("\n  Deployer:", deployer.address);
  console.log("  Network :", netName);

  // Load current deployment info
  const deployments = loadDeployments();
  const currentDeployment = deployments[netName]?.latest;
  
  if (!currentDeployment) {
    throw new Error("No deployment found for network: " + netName);
  }
  
  const proxyAddress = currentDeployment.proxyAddress;
  const oldVersion = currentDeployment.version;
  
  console.log("\n  Current Deployment:");
  console.log("  Proxy Address     :", proxyAddress);
  console.log("  Current Version   :", oldVersion);
  console.log("  Previous Impl     :", currentDeployment.implementationAddress);
  
  console.log("\n  Deploying new implementation...");
  
  // Deploy new implementation (V2)
  const IkiminaV2 = await ethers.getContractFactory("IkiminaV2");
  
  console.log("  Upgrading proxy to V2...");
  
  // Upgrade the proxy
  const upgraded = await upgrades.upgradeProxy(proxyAddress, IkiminaV2, {
    kind: "uups",
    timeout: 60000,
    call: { fn: "upgradeVersion", args: ["2.0.0"] } // Optional: update version
  });
  
  await upgraded.waitForDeployment();
  
  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const upgradeTx = upgraded.deploymentTransaction();
  const upgradedAt = new Date().toISOString();
  
  console.log("\n─".repeat(52));
  console.log("  UPGRADE SUCCESSFUL");
  console.log("─".repeat(52));
  console.log("  New Implementation:", newImplementation);
  console.log("  Tx hash           :", upgradeTx.hash);
  console.log("  Upgrade Time      :", upgradedAt);
  
  // Verify new version
  const newVersion = await upgraded.version();
  console.log("  New Version       :", newVersion);
  
  // Update deployment record
  const upgradeEntry = {
    ...currentDeployment,
    implementationAddress: newImplementation,
    version: newVersion,
    previousImplementation: currentDeployment.implementationAddress,
    upgradeTxHash: upgradeTx.hash,
    upgradedAt,
    upgradeCount: (currentDeployment.upgradeCount || 0) + 1
  };
  
  deployments[netName].latest = upgradeEntry;
  deployments[netName].history.unshift(upgradeEntry);
  saveDeployments(deployments);
  
  console.log("\n  Updated deployments/deployments.json");
  console.log("─".repeat(52));
  console.log("  Upgrade complete! Contract now running V2");
  console.log("─".repeat(52));
}

main().catch((error) => {
  console.error("\n  Upgrade failed:", error);
  process.exitCode = 1;
});
// scripts/deploy-upgradeable.js
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENTS_DIR = path.join(__dirname, "../deployments");
const DEPLOYMENTS_FILE = path.join(DEPLOYMENTS_DIR, "deployments.json");

function loadDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    return {};
  }
  
  try {
    const content = fs.readFileSync(DEPLOYMENTS_FILE, "utf8");
    if (!content.trim()) {
      return {};
    }
    return JSON.parse(content);
  } catch (error) {
    console.log("  Warning: Could not parse deployments.json, creating new file");
    return {};
  }
}

function saveDeployments(data) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  console.log("─".repeat(52));
  console.log("  Deploying Upgradeable IkiminaV1");
  console.log("─".repeat(52));

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = chainId === 11155111 ? "sepolia" : chainId === 31337 ? "localhost" : "unknown";
  
  console.log("\n  Deployer:", deployer.address);
  console.log("  Network:", networkName, `(chainId: ${chainId})`);
  console.log("  Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  console.log("\n  Deploying IkiminaV1...");
  
  const IkiminaV1 = await ethers.getContractFactory("IkiminaV1");
  
  const ikiminaV1 = await upgrades.deployProxy(IkiminaV1, [], {
    initializer: "initialize",
    kind: "uups"
  });
  
  await ikiminaV1.waitForDeployment();
  
  const proxyAddress = await ikiminaV1.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const deployTx = ikiminaV1.deploymentTransaction();
  const deployedAt = new Date().toISOString();
  
  console.log("\n─".repeat(52));
  console.log("  DEPLOYMENT SUCCESSFUL");
  console.log("─".repeat(52));
  console.log("  Proxy Address        :", proxyAddress);
  console.log("  Implementation Address:", implementationAddress);
  console.log("  Tx hash              :", deployTx.hash);
  console.log("─".repeat(52));
  
  // Verify the contract works
  const version = await ikiminaV1.version();
  const admin = await ikiminaV1.admin();
  const totalPool = await ikiminaV1.totalPool();
  const memberCount = await ikiminaV1.memberCount();
  
  console.log("\n  Version:", version);
  console.log("  Admin:", admin);
  console.log("  Total Pool:", ethers.formatEther(totalPool), "ETH");
  console.log("  Member Count:", memberCount.toString());
  
  // Save to deployments.json
  const deployments = loadDeployments();
  
  // Keep old contracts if they exist
  if (!deployments[networkName]) {
    deployments[networkName] = { chainId, history: [] };
  }
  
  const entry = {
    contract: "IkiminaV1",
    proxyAddress: proxyAddress,
    implementationAddress: implementationAddress,
    deployer: deployer.address,
    txHash: deployTx.hash,
    deployedAt,
    version: version,
    isUpgradeable: true,
    network: networkName,
    chainId: chainId
  };
  
  // Add to history (newest first)
  deployments[networkName].history.unshift(entry);
  deployments[networkName].latest = entry;
  deployments[networkName].chainId = chainId;
  
  saveDeployments(deployments);
  
  console.log("\n  📁 Saved to deployments/deployments.json");
  console.log("─".repeat(52));
  console.log("  ✅ IkiminaV1 is ready to use!");
  console.log(`  Update your frontend with proxy address: ${proxyAddress}`);
  console.log("─".repeat(52));
}

main().catch((error) => {
  console.error("\n  Deployment failed:", error.message);
  process.exitCode = 1;
});
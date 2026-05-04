// scripts/deploy.js
// Usage: npx hardhat run scripts/deploy.js --network sepolia

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ── Config ───────────────────────────────────────────────────
const DEPLOYMENTS_DIR  = path.join(__dirname, "../deployments");
const DEPLOYMENTS_FILE = path.join(DEPLOYMENTS_DIR, "deployments.json");

// ── Helpers ──────────────────────────────────────────────────
function loadDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
}

function saveDeployments(data) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("─".repeat(52));
  console.log("  Ikimina – Deployment Script");
  console.log("─".repeat(52));

  // 1. Signer info
  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);
  const networkObj = await ethers.provider.getNetwork();
  const chainId    = Number(networkObj.chainId);
  const netName    = network.name;

  console.log("\n  Deployer  :", deployer.address);
  console.log("  Balance   :", ethers.formatEther(balance), "ETH");
  console.log("  Network   :", netName, `(chainId: ${chainId})`);

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Balance too low. Need at least 0.01 ETH.");
  }

  // 2. Deploy
  console.log("\n  Deploying Ikimina...\n");
  const Ikimina = await ethers.getContractFactory("Ikimina");
  const ikimina = await Ikimina.deploy();
  await ikimina.waitForDeployment();

  const contractAddress = await ikimina.getAddress();
  const deployTx        = ikimina.deploymentTransaction();
  const deployedAt      = new Date().toISOString();

  // 3. Print summary
  console.log("─".repeat(52));
  console.log("  DEPLOYMENT SUCCESSFUL");
  console.log("─".repeat(52));
  console.log("  Contract  :", contractAddress);
  console.log("  Tx hash   :", deployTx.hash);
  console.log("─".repeat(52));
  console.log("\n  Etherscan :");
  console.log(`  https://sepolia.etherscan.io/address/${contractAddress}`);

  // 4. Post-deploy smoke test
  console.log("\n  Running post-deploy checks...");
  const admin      = await ikimina.admin();
  const totalPool  = await ikimina.totalPool();
  const multiplier = await ikimina.LOAN_MULTIPLIER();
  const interest   = await ikimina.INTEREST_BPS();

  console.log("  admin()         :", admin);
  console.log("  totalPool()     :", ethers.formatEther(totalPool), "ETH");
  console.log("  LOAN_MULTIPLIER :", multiplier.toString(), "x");
  console.log("  INTEREST_BPS    :", interest.toString(), "bps (5%)");

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Admin mismatch – deployment may be corrupted.");
  }

  // ── 5. Save to deployments/deployments.json ───────────────
  const deployments = loadDeployments();

  // Keep history of all past deploys per network
  if (!deployments[netName]) {
    deployments[netName] = { chainId, history: [] };
  }

  const entry = {
    contract       : "Ikimina",
    address        : contractAddress,
    deployer       : deployer.address,
    txHash         : deployTx.hash,
    deployedAt,
    loanMultiplier : multiplier.toString(),
    interestBps    : interest.toString(),
  };

  // Latest always at top level for easy import
  deployments[netName].latest  = entry;
  deployments[netName].chainId = chainId;

  // Push to history array (newest first)
  deployments[netName].history.unshift(entry);

  saveDeployments(deployments);

  console.log("\n  Saved → deployments/deployments.json");
  console.log("─".repeat(52));
  console.log("  All checks passed. Ikimina is live!");
  console.log("─".repeat(52));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n  Deployment failed:", err.message);
    process.exit(1);
  });
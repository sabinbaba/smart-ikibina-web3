// scripts/migrate.js
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("─".repeat(52));
  console.log("  Migrating Ikimina to Upgradeable IkiminaV1");
  console.log("─".repeat(52));

  const OLD_CONTRACT_ADDRESS = "0x6B556d24647a74880302E0BE8036bA3DDBF77c74";
  
  // Get old contract instance
  const oldIkimina = await ethers.getContractAt("Ikimina", OLD_CONTRACT_ADDRESS);
  
  console.log("\n📊 Reading data from old contract...");
  
  // Read all data from old contract
  const admin = await oldIkimina.admin();
  const totalPool = await oldIkimina.totalPool();
  const reservePool = await oldIkimina.reservePool();
  const memberCount = await oldIkimina.memberCount();
  const currentTermId = await oldIkimina.currentTermId();
  const memberList = await oldIkimina.getMemberList();
  
  console.log(`  Admin: ${admin}`);
  console.log(`  Total Pool: ${ethers.formatEther(totalPool)} ETH`);
  console.log(`  Member Count: ${memberCount}`);
  console.log(`  Members: ${memberList.length}`);
  
  // Deploy new upgradeable contract
  console.log("\n🚀 Deploying upgradeable IkiminaV1...");
  
  const IkiminaV1 = await ethers.getContractFactory("IkiminaV1");
  const ikiminaV1 = await upgrades.deployProxy(IkiminaV1, [], {
    initializer: "initialize",
    kind: "uups"
  });
  
  await ikiminaV1.waitForDeployment();
  const proxyAddress = await ikiminaV1.getAddress();
  
  console.log(`\n✅ New proxy deployed at: ${proxyAddress}`);
  
  // Migrate members
  console.log("\n📦 Migrating members...");
  
  for (let i = 0; i < memberList.length; i++) {
    const wallet = memberList[i];
    const member = await oldIkimina.getMember(wallet);
    
    if (member.isRegistered) {
      console.log(`  Migrating: ${member.name} (${wallet})`);
      
      // Register with Regular role by default
      await ikiminaV1.register(
        member.name,
        member.email,
        member.phone,
        wallet,
        0 // 0 = Regular role
      );
      
      // Transfer savings if any
      const savings = member.savings;
      if (savings > 0) {
        // Note: You'll need to handle ETH transfer separately
        console.log(`    Savings: ${ethers.formatEther(savings)} ETH`);
      }
    }
  }
  
  console.log("\n─".repeat(52));
  console.log("  Migration Complete!");
  console.log("─".repeat(52));
  console.log(`  Old Contract: ${OLD_CONTRACT_ADDRESS}`);
  console.log(`  New Proxy:    ${proxyAddress}`);
  console.log("\n  Update your frontend to use the new proxy address!");
}

main().catch(console.error);
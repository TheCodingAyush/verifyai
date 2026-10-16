import fs from "fs";
import path from "path";
import hre from "hardhat";

async function main() {
  const { ethers, networkName } = await hre.network.create();
  console.log(`Connecting smoke test to network: ${networkName}`);

  // Determine record file based on network
  const recordFileName = networkName === "sepolia" ? "sepolia.json" : "localhost.json";
  const recordPath = path.resolve("./deployment", recordFileName);

  if (!fs.existsSync(recordPath)) {
    throw new Error(
      `Deployment record not found at: ${recordPath}. Please run export-deployment first.`
    );
  }

  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const { address, contractName } = record;
  console.log(`Target contract: ${contractName} at ${address}`);

  const registry = await ethers.getContractAt(contractName, address);

  // Read-only calls:
  const owner = await registry.owner();
  const pendingOwner = await registry.pendingOwner();
  const modelNames = await registry.getModelNames();
  const stats = await registry.getStats();
  const reportCount = await registry.reportCount();

  console.log("\n--- Smoke Test Results ---");
  console.log(`owner():        ${owner}`);
  console.log(`pendingOwner(): ${pendingOwner}`);
  console.log(`getModelNames(): ${JSON.stringify(modelNames)}`);
  console.log("getStats():");
  console.log(`  total:         ${stats.total.toString()}`);
  console.log(`  aiGenerated:   ${stats.aiGenerated.toString()}`);
  console.log(`  aiAssisted:    ${stats.aiAssisted.toString()}`);
  console.log(`  humanCreated:  ${stats.humanCreated.toString()}`);
  console.log(`  active:        ${stats.active.toString()}`);
  console.log(`  disputed:      ${stats.disputed.toString()}`);
  console.log(`  revoked:       ${stats.revoked.toString()}`);
  console.log(`reportCount():  ${reportCount.toString()}`);
  console.log("--------------------------\n");
  console.log("Smoke test passed successfully (all read-only calls completed, 0 transactions sent).");
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
});

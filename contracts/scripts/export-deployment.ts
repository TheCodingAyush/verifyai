import fs from "fs";
import path from "path";
import hre from "hardhat";

async function main() {
  const { ethers, networkName } = await hre.network.create();
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Exporting deployment for network: ${networkName} (chainId: ${chainId})`);

  // Path to ignition deployment folder
  const ignitionDir = path.resolve(`./ignition/deployments/chain-${chainId}`);
  if (!fs.existsSync(ignitionDir)) {
    throw new Error(`Ignition deployment directory not found at: ${ignitionDir}. Have you deployed to chain ${chainId}?`);
  }

  // 1. Read deployed_addresses.json
  const deployedAddressesPath = path.join(ignitionDir, "deployed_addresses.json");
  if (!fs.existsSync(deployedAddressesPath)) {
    throw new Error(`deployed_addresses.json not found in ${ignitionDir}`);
  }
  const deployedAddresses = JSON.parse(fs.readFileSync(deployedAddressesPath, "utf8"));
  const contractFutureId = "VerifyAIRegistryModule#VerifyAIRegistry";
  const address = deployedAddresses[contractFutureId];
  if (!address) {
    throw new Error(`Contract "${contractFutureId}" not found in ${deployedAddressesPath}`);
  }

  // 2. Read journal.jsonl to find deployTxHash and deployBlock
  const journalPath = path.join(ignitionDir, "journal.jsonl");
  let deployTxHash = "";
  let deployBlock = 0;
  if (fs.existsSync(journalPath)) {
    const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n");
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "TRANSACTION_CONFIRM" && entry.futureId === contractFutureId) {
          deployTxHash = entry.hash;
          deployBlock = entry.receipt?.blockNumber ?? 0;
          break;
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  // If block was found, fetch block timestamp for deployedAt
  let deployedAt = new Date().toISOString();
  if (deployBlock > 0) {
    try {
      const block = await provider.getBlock(deployBlock);
      if (block) {
        deployedAt = new Date(Number(block.timestamp) * 1000).toISOString();
      }
    } catch (err) {
      console.warn("Could not fetch block timestamp, using current time:", err);
    }
  }

  // 3. Read compiled artifact for ABI and solcVersion
  const artifactPath = path.resolve("./artifacts/contracts/VerifyAIRegistry.sol/VerifyAIRegistry.json");
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found at ${artifactPath}. Please run "npx hardhat compile".`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const contractName = artifact.contractName || "VerifyAIRegistry";
  const abi = artifact.abi;

  // Read solcVersion from build-info
  let solcVersion = "0.8.28";
  if (artifact.buildInfoId) {
    const buildInfoPath = path.resolve(`./artifacts/build-info/${artifact.buildInfoId}.json`);
    if (fs.existsSync(buildInfoPath)) {
      const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
      solcVersion = buildInfo.solcVersion || solcVersion;
    }
  }

  // 4. Connect to contract to fetch actual on-chain owner
  const registry = await ethers.getContractAt(contractName, address);
  const owner = await registry.owner();

  // 5. Ensure contracts/deployment folder exists
  const deploymentDir = path.resolve("./deployment");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  // 6. Write ABI file
  const abiOutputPath = path.join(deploymentDir, `${contractName}.abi.json`);
  fs.writeFileSync(abiOutputPath, JSON.stringify(abi, null, 2), "utf8");
  console.log(`Saved ABI to: ${abiOutputPath}`);

  // 7. Determine record output file name
  // Must NOT create or overwrite sepolia.json when running on local/other networks!
  const recordFileName = networkName === "sepolia" ? "sepolia.json" : "localhost.json";
  const recordOutputPath = path.join(deploymentDir, recordFileName);

  const deploymentRecord = {
    chainId,
    network: networkName,
    contractName,
    address,
    owner,
    deployTxHash,
    deployBlock,
    deployedAt,
    solcVersion,
  };

  fs.writeFileSync(recordOutputPath, JSON.stringify(deploymentRecord, null, 2), "utf8");
  console.log(`Saved deployment record to: ${recordOutputPath}`);
  console.log(JSON.stringify(deploymentRecord, null, 2));
}

main().catch((error) => {
  console.error("Export deployment failed:", error);
  process.exitCode = 1;
});

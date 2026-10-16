# VerifyAI Smart Contracts

VerifyAI is an on-chain provenance registry for AI-generated and human-created content. Only SHA-256 hashes and declared metadata are stored on-chain.

## Project Structure

All contract commands should be executed from this folder (`contracts/`):

- `contracts/VerifyAIRegistry.sol`: Core registry contract (inherits OpenZeppelin 5.x `Ownable2Step`).
- `test/VerifyAIRegistry.ts`: Comprehensive test suite (70 tests covering all features and edge cases).
- `ignition/modules/VerifyAIRegistry.ts`: Hardhat Ignition deployment module.
- `scripts/export-deployment.ts`: Exports deployment records and ABI from Ignition artifacts.
- `scripts/smoke-test.ts`: Read-only verification of deployed contract state.
- `deployment/`: Contains exported deployment records and contract ABI.

## Running Tests

Run all unit and integration tests:

```shell
npx hardhat test
```

## Deploying to Sepolia

Follow these steps in order to deploy `VerifyAIRegistry` to Ethereum Sepolia (chain ID `11155111`).

### 1. Set Configuration Variables (Encrypted Keystore)

Store your RPC URL, private key, and Etherscan API key securely in Hardhat 3's encrypted keystore. You will be prompted to enter each value and set/enter your keystore password:

```shell
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

> **Security Note:** Never commit secrets, write them to `.env`, or hardcode them into config files. Hardhat 3 resolves these securely from the keystore at runtime.

### 2. Deploy using Hardhat Ignition

Deploy `VerifyAIRegistry` to Sepolia. The Ignition module passes `m.getAccount(0)` (derived from `SEPOLIA_PRIVATE_KEY`) as the `initialOwner`:

```shell
npx hardhat ignition deploy ignition/modules/VerifyAIRegistry.ts --network sepolia
```

This will write deployment records to `ignition/deployments/chain-11155111/`.

### 3. Export Deployment Record and ABI

Extract the deployed contract address, transaction hash, block number, timestamp, and ABI:

```shell
npx hardhat run scripts/export-deployment.ts --network sepolia
```

This writes:
- `deployment/sepolia.json` (deployment record metadata)
- `deployment/VerifyAIRegistry.abi.json` (contract ABI for frontend use)

### 4. Verify on Etherscan

Verify the source code on Etherscan using the contract address and the deployer wallet address (the constructor argument for `initialOwner`):

```shell
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <DEPLOYER_ADDRESS>
```

*(Alternatively, you can run `npx hardhat ignition verify chain-11155111`)*.

### 5. Run Smoke Test

Run the read-only smoke-test script to verify that the contract is accessible on Sepolia and initialized correctly (sends 0 transactions):

```shell
npx hardhat run scripts/smoke-test.ts --network sepolia
```

The script will query and print:
- `owner()`
- `pendingOwner()`
- `getModelNames()`
- `getStats()`
- `reportCount()`

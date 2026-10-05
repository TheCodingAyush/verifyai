import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const VerifyAIRegistryModule = buildModule("VerifyAIRegistryModule", (m) => {
  const deployer = m.getAccount(0);
  const registry = m.contract("VerifyAIRegistry", [deployer]);
  return { registry };
});

export default VerifyAIRegistryModule;

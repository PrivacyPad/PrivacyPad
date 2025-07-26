import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Log deployer address for reference
  console.log("Deployer address:", deployer);

  // Deploy TokenFactory contract
  const tokenFactory = await deploy("TokenFactory", {
    from: deployer,
    log: true,
  });

  // Log deployed contract address
  console.log(`TokenFactory deployed at:`, tokenFactory.address);

  // Verify deployment by checking if contract was deployed successfully
  if (tokenFactory.address) {
    console.log("✅ TokenFactory deployment successful!");
    console.log("📋 Contract Address:", tokenFactory.address);
    console.log("🔗 Transaction Hash:", tokenFactory.transactionHash);
  } else {
    console.log("❌ TokenFactory deployment failed!");
  }
};

export default func;
func.id = "deploy_tokenFactory"; // id required to prevent reexecution
func.tags = ["TokenFactory"];

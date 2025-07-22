import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Deploys the ConfidentialWETH contract.
 * No constructor arguments are required.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Log deployer address for reference
  console.log("Deployer address:", deployer);

  // Deploy ConfidentialWETH contract
  const deployedCWETH = await deploy("ConfidentialWETH", {
    from: deployer,
    log: true,
  });

  // Log deployed contract address
  console.log(`ConfidentialWETH deployed at:`, deployedCWETH.address);
};

export default func;
func.id = "deploy_confidentialWETH"; // id required to prevent reexecution
func.tags = ["ConfidentialWETH"];

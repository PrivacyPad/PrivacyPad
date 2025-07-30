import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// =============================
// Set these addresses before deploying!
// You must provide the deployed addresses for uniswapV2Router02.
// For local testing, deploy or use mock contracts and paste their addresses here.
// =============================

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  // Log deployer address for reference
  console.log("Deployer address:", deployer);

  // Get the deployed ConfidentialWETH address
  const cwethDeployment = await get("ConfidentialWETH");
  const cwethAddress = cwethDeployment.address;
  console.log("Using ConfidentialWETH address:", cwethAddress);

  // Deploy lib contract
  const lib = await deploy("PrivacyPresaleLib", { from: deployer, log: true });

  // Deploy PrivacyPresaleFactory contract
  const factory = await deploy("PrivacyPresaleFactory", {
    from: deployer,
    log: true,
    args: [cwethAddress],
    libraries: {
      PrivacyPresaleLib: lib.address,
    },
  });

  // Log deployed contract address
  console.log(`PrivacyPresaleFactory deployed at:`, factory.address);
};
export default func;
func.id = "deploy_privacyPresaleFactory"; // id required to prevent reexecution
func.tags = ["PrivacyPresaleFactory"];

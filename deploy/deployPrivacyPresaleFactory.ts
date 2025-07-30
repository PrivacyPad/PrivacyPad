import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// =============================
// Set these addresses before deploying!
// You must provide the deployed addresses for cweth and uniswapV2Router02.
// For local testing, deploy or use mock contracts and paste their addresses here.
// =============================
const CWETH_ADDRESS = "0x1A7258dFA114fc3Daf2849F131aF022E3Ec90eEe"; // e.g., "0x..."

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Log deployer address for reference
  console.log("Deployer address:", deployer);

  // Deploy lin contract
  const lib = await deploy("PrivacyPresaleLib", { from: deployer, log: true });

  // Deploy PrivacyPresaleFactory contract
  const factory = await deploy("PrivacyPresaleFactory", {
    from: deployer,
    log: true,
    args: [CWETH_ADDRESS],
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

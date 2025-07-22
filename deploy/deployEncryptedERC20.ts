import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("deployer: ", deployer);

  const deployedEncryptedERC20 = await deploy("EncryptedERC20", {
    from: deployer,
    log: true,
    args: ["My Private Token", "MPT"],
  });

  console.log(`EncryptedERC20 contract: `, deployedEncryptedERC20.address);
};
export default func;
func.id = "deploy_encryptedERC20"; // id required to prevent reexecution
func.tags = ["EncryptedERC20"];

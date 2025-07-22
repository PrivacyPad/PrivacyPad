// import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * Tutorial: Deploy and Interact Locally (--network localhost)
 * ===========================================================
 *
 * 1. From a separate terminal window:
 *
 *   npx hardhat node
 *
 * 2. Deploy the FHECounter contract
 *
 *   npx hardhat --network localhost deploy
 *
 * 3. Interact with the FHECounter contract
 *
 *   npx hardhat --network localhost task:decrypt-count
 *   npx hardhat --network localhost task:increment --value 2
 *   npx hardhat --network localhost task:decrement --value 1
 *   npx hardhat --network localhost task:decrypt-count
 *
 *
 * Tutorial: Deploy and Interact on Sepolia (--network sepolia)
 * ===========================================================
 *
 * 1. Deploy the FHECounter contract
 *
 *   npx hardhat --network sepolia deploy
 *
 * 2. Interact with the FHECounter contract
 *
 *   npx hardhat --network sepolia task:mint --value 1000000000000000
 *
 */

/**
 * Example:
 *   - npx hardhat --network localhost task:mint --value 1000000000000000
 *   - npx hardhat --network sepolia task:mint --value 1000000000000000
 */
task("task:mint", "Calls the mint() function of EncryptedERC20 Contract")
  .addParam("value", "The mint value")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const value = parseInt(taskArguments.value);
    if (!Number.isInteger(value)) {
      throw new Error(`Argument --value is not an integer`);
    }

    await fhevm.initializeCLIApi();

    const EncryptedERC20Deployement = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("EncryptedERC20");
    console.log(`EncryptedERC20: ${EncryptedERC20Deployement.address}`);

    const signers = await ethers.getSigners();
    const owner = signers[5];

    const encryptedERC20Contract = await ethers.getContractAt("EncryptedERC20", EncryptedERC20Deployement.address);

    // Encrypt the value passed as argument
    // const encryptedValue = await fhevm
    //   .createEncryptedInput(EncryptedERC20Deployement.address, signers[0].address)
    //   .add32(value)
    //   .encrypt();

    const tx = await encryptedERC20Contract.connect(owner).mint(value);
    console.log(`Wait for tx:${tx.hash}...`);

    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);

    const newEncryptedBalance = await encryptedERC20Contract.balanceOf(owner.address);
    console.log("Encrypted balance after mint:", newEncryptedBalance);

    console.log(`EncryptedERC20 mint(${value}) succeeded!`);
  });

import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

/**
 * PrivacyPresale and PrivacyPresaleFactory Interaction Tasks
 * ===========================================================
 *
 * This file provides tasks to interact with the PrivacyPresale system:
 * - Deploy factory and create presales
 * - Wrap ETH to cWETH
 * - Purchase tokens in presales
 * - Claim tokens after successful presales
 * - Refund contributions for failed presales
 * - Finalize presales
 *
 * Tutorial: Complete Presale Flow
 * ===============================
 *
 * 1. Deploy factory and create a presale:
 *    npx hardhat --network sepolia task:deploy-factory
 *    npx hardhat --network sepolia task:create-presale --name "TestToken" --symbol "TTK" --hardcap 10 --softcap 6
 *
 * 2. Wrap ETH to cWETH:
 *    npx hardhat --network sepolia task:wrap-eth --amount 5 --user 1
 *
 * 3. Purchase tokens:
 *    npx hardhat --network sepolia task:purchase --amount 2 --user 1 --presale <ADDRESS>
 *
 * 4. Finalize presale:
 *    npx hardhat --network sepolia task:finalize-presale --presale <ADDRESS> --user 1
 *
 * 5. Claim tokens:
 *    npx hardhat --network sepolia task:claim-tokens --presale <ADDRESS> --user 1
 */

// Helper function to get signer by index
async function getSigner(hre: HardhatRuntimeEnvironment, userIndex: number) {
  const signers = await hre.ethers.getSigners();
  if (userIndex >= signers.length) {
    throw new Error(`User index ${userIndex} out of range. Available: 0-${signers.length - 1}`);
  }
  return signers[userIndex];
}

// Helper function to format amounts
function formatAmount(amount: bigint, decimals: number = 9, hre: HardhatRuntimeEnvironment): string {
  return hre.ethers.formatUnits(amount, decimals);
}

// Helper function to parse amounts
function parseAmount(amount: string, decimals: number = 9, hre: HardhatRuntimeEnvironment): bigint {
  return hre.ethers.parseUnits(amount, decimals);
}

/**
 * Create a new presale
 * Example:  npx hardhat --network sepolia task:create-presale --name "TestToken" --symbol "TTK" --hardcap 0.005 --softcap 0.002 --tokenpresale 525000 --tokenaddliquidity 125000 --duration 0 --liquidity 50
 */
task("task:create-presale", "Create a new privacy presale")
  .addParam("name", "Token name")
  .addParam("symbol", "Token symbol")
  .addParam("hardcap", "Hard cap in ETH")
  .addParam("softcap", "Soft cap in ETH")
  .addParam("tokenpresale", "Token presale amount")
  .addParam("tokenaddliquidity", "Token add liquidity amount")
  .addOptionalParam("factory", "Factory contract address")
  .addOptionalParam("duration", "Presale duration in hours", "1")
  .addOptionalParam("liquidity", "Liquidity percentage (0-100)", "50")
  .addOptionalParam("user", "User index (0, 1, 2, etc.)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Creating new privacy presale...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const signers = await hre.ethers.getSigners();
    // @note check your signer index
    const deployer = signers[parseInt(taskArguments.user)];
    console.log("Deployer address:", deployer.address);

    // Get factory address
    let factoryAddress = taskArguments.factory;
    if (!factoryAddress) {
      // Try to get from deployments
      try {
        const { deployments } = hre;
        const factoryDeployment = await deployments.get("PrivacyPresaleFactory");
        factoryAddress = factoryDeployment.address;
      } catch {
        throw new Error(
          "Factory address not provided and not found in deployments. Please deploy factory first or provide --factory address",
        );
      }
    }
    console.log("Factory address:", factoryAddress);

    const factory = await hre.ethers.getContractAt("PrivacyPresaleFactory", factoryAddress);

    // Parse parameters
    const hardCap = parseAmount(taskArguments.hardcap, 9, hre);
    const softCap = parseAmount(taskArguments.softcap, 9, hre);
    const duration = parseInt(taskArguments.duration) * 3600; // Convert hours to seconds
    const liquidityPercentage = BigInt(parseInt(taskArguments.liquidity) * 100); // Convert to basis points

    // Calculate timestamps
    const now = Math.floor(Date.now() / 1000);
    const startTime = BigInt(now); // Start now
    const endTime = BigInt(now + duration + 1);

    // Token amounts (1 billion tokens each for presale and liquidity)
    const tokenPresale = hre.ethers.parseUnits(taskArguments.tokenpresale, 18);
    const tokenAddLiquidity = hre.ethers.parseUnits(taskArguments.tokenaddliquidity, 18);

    // Create presale options
    const presaleOptions = {
      tokenAddLiquidity,
      tokenPresale,
      liquidityPercentage,
      hardCap: BigInt(hardCap),
      softCap: BigInt(softCap),
      start: startTime,
      end: endTime,
    };

    console.log("Presale configuration:");
    console.log("- Token name:", taskArguments.name);
    console.log("- Token symbol:", taskArguments.symbol);
    console.log("- Hard cap:", formatAmount(hardCap, 9, hre), "ETH");
    console.log("- Soft cap:", formatAmount(softCap, 9, hre), "ETH");
    console.log("- Duration:", taskArguments.duration, "hours");
    console.log("- Liquidity percentage:", taskArguments.liquidity, "%");
    console.log("- Start time:", new Date(Number(startTime) * 1000).toISOString());
    console.log("- End time:", new Date(Number(endTime) * 1000).toISOString());

    // Create presale
    const tx = await factory
      .connect(deployer)
      .createPrivacyPresaleWithNewToken(
        taskArguments.name,
        taskArguments.symbol,
        tokenPresale + tokenAddLiquidity,
        presaleOptions,
      );

    console.log("Creating presale...");
    const receipt = await tx.wait();

    // Extract presale address from event
    const event = receipt?.logs
      .map((log: unknown) => {
        try {
          return factory.interface.parseLog(log as { topics: readonly string[]; data: string });
        } catch {
          return null;
        }
      })
      .find((e: unknown) => e && (e as { name?: string }).name === "PrivacyPresaleCreated");

    if (!event) {
      throw new Error("Failed to extract presale address from deployment event");
    }

    const presaleAddress = event.args.presale;
    const tokenAddress = event.args.token;
    const ctokenAddress = event.args.ctoken;

    console.log("✅ Presale created successfully!");
    console.log("Presale address:", presaleAddress);
    console.log("Token address:", tokenAddress);
    console.log("Confidential token address:", ctokenAddress);

    return { presaleAddress, tokenAddress, ctokenAddress };
  });

/**
 * Purchase tokens in presale
 * Example: npx hardhat --network sepolia task:purchase --amount 0.003 --presale <ADDRESS>
 */
task("task:purchase", "Purchase tokens in a presale")
  .addParam("amount", "Amount of cWETH to invest")
  .addParam("presale", "Presale contract address")
  .addOptionalParam("beneficiary", "Beneficiary address (defaults to user)")
  .addOptionalParam("user", "User index (0, 1, 2, etc.)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Purchasing tokens in presale...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const beneficiary = taskArguments.beneficiary || user.address;
    const amount = parseAmount(taskArguments.amount, 9, hre);

    // Get presale contract
    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get cWETH address from presale
    const pool = await presale.pool();
    const cwethAddress = pool.cweth;
    const cweth = await hre.ethers.getContractAt("ConfidentialWETH", cwethAddress);

    console.log(`Purchasing ${formatAmount(amount, 9, hre)} cWETH worth of tokens...`);
    console.log("User:", user.address);
    console.log("Beneficiary:", beneficiary);

    // Check if user has enough cWETH
    const balance = await cweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), cwethAddress, user);

    if (clearBalance < amount) {
      throw new Error(`Insufficient cWETH balance. Have: ${clearBalance}, Need: ${amount}`);
    }

    // Approve presale to spend cWETH
    console.log("Approving presale to spend cWETH...");
    const now = Math.floor(Date.now() / 1000);
    const expiry = BigInt(now + 1000); // 1000 seconds from now
    await cweth.connect(user).setOperator(taskArguments.presale, expiry);

    // Create encrypted purchase input
    console.log("Creating encrypted purchase input...");
    const encrypted = await fhevm.createEncryptedInput(taskArguments.presale, user.address).add64(amount).encrypt();

    // Purchase tokens
    console.log("Executing purchase...");
    const tx = await presale.connect(user).purchase(beneficiary, encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Get contribution and claimable tokens
    const [contribution, claimableTokens] = await Promise.all([
      presale.contributions(beneficiary),
      presale.claimableTokens(beneficiary),
    ]);

    const [clearContribution, clearClaimableTokens] = await Promise.all([
      fhevm.userDecryptEuint(FhevmType.euint64, contribution.toString(), taskArguments.presale, user),
      fhevm.userDecryptEuint(FhevmType.euint64, claimableTokens.toString(), taskArguments.presale, user),
    ]);

    console.log("✅ Purchase completed successfully!");
    console.log("Contribution:", clearContribution.toString());
    console.log("Claimable tokens:", clearClaimableTokens.toString());

    return { contribution: clearContribution, claimableTokens: clearClaimableTokens };
  });

/**
 * Request finalize presale
 * Example: npx hardhat --network sepolia task:request-finalize --presale <ADDRESS> --user 1
 */
task("task:request-finalize", "Request to finalize a presale")
  .addParam("presale", "Presale contract address")
  .addOptionalParam("user", "User index (0, 1, 2, etc.)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    // No destructuring needed for this task

    console.log("Requesting presale finalization...");

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get current pool state
    const pool = await presale.pool();
    console.log("Current pool state:", pool.state);
    console.log("Current time:", new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
    console.log("Presale end time:", new Date(Number(pool.options.end) * 1000).toISOString());

    // Request finalization
    console.log("Requesting finalization...");
    const tx = await presale.connect(user).requestFinalizePresaleState();
    await tx.wait();

    console.log("✅ Finalization requested successfully!");
    console.log("Transaction hash:", tx.hash);

    return { txHash: tx.hash };
  });

/**
 * Finalize presale (simulated for testing)
 * Example: npx hardhat --network sepolia task:finalize-presale --presale <ADDRESS> --user 1
 */
task("task:finalize-presale", "Finalize a presale (simulated for testing)")
  .addParam("presale", "Presale contract address")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Finalizing presale...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const _user = await getSigner(hre, parseInt(taskArguments.user));
    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get pool state before finalization
    const poolBefore = await presale.pool();
    console.log("Pool state before finalization:", poolBefore.state);

    // Wait for decryption oracle
    await fhevm.awaitDecryptionOracle();

    // Get pool state after finalization
    const poolAfter = await presale.pool();
    console.log("Pool state after finalization:", poolAfter.state);
    console.log("Wei raised:", formatAmount(poolAfter.weiRaised, 9, hre));
    console.log("Tokens sold:", formatAmount(poolAfter.tokensSold, 18, hre));

    // Determine final state
    let stateDescription = "Unknown";
    switch (Number(poolAfter.state)) {
      case 1:
        stateDescription = "Active";
        break;
      case 2:
        stateDescription = "Waiting for finalize";
        break;
      case 3:
        stateDescription = "Cancelled";
        break;
      case 4:
        stateDescription = "Finalized";
        break;
    }

    console.log("✅ Presale finalization completed!");
    console.log("Final state:", stateDescription);
    console.log("Final wei raised:", formatAmount(poolAfter.weiRaised, 9, hre));
    console.log("Final tokens sold:", formatAmount(poolAfter.tokensSold, 18, hre));

    return {
      state: poolAfter.state,
      stateDescription,
      weiRaised: poolAfter.weiRaised,
      tokensSold: poolAfter.tokensSold,
    };
  });

/**
 * Claim tokens after successful presale
 * Example: npx hardhat --network sepolia task:claim-tokens --presale <ADDRESS> --user 1
 */
task("task:claim-tokens", "Claim tokens after successful presale")
  .addParam("presale", "Presale contract address")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addOptionalParam("beneficiary", "Beneficiary address (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Claiming tokens...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const beneficiary = taskArguments.beneficiary || user.address;

    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get pool state
    const pool = await presale.pool();
    if (Number(pool.state) !== 4) {
      throw new Error(`Presale is not finalized. Current state: ${pool.state}`);
    }

    // Check if already claimed
    const claimed = await presale.claimed(user.address);
    if (claimed) {
      throw new Error("Tokens already claimed by this user");
    }

    // Get claimable tokens
    const claimableTokens = await presale.claimableTokens(user.address);
    const clearClaimableTokens = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      claimableTokens.toString(),
      taskArguments.presale,
      user,
    );

    console.log(`Claiming ${clearClaimableTokens.toString()} tokens for ${beneficiary}...`);

    // Claim tokens
    const tx = await presale.connect(user).claimTokens(beneficiary);
    await tx.wait();

    // Get token balance after claiming
    const ctoken = await hre.ethers.getContractAt("ConfidentialTokenWrapper", pool.ctoken);
    const balance = await ctoken.balanceOf(beneficiary);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance.toString(),
      await ctoken.getAddress(),
      user,
    );

    console.log("✅ Tokens claimed successfully!");
    console.log("Claimed amount:", clearClaimableTokens.toString());
    console.log("New balance:", clearBalance.toString());

    return { claimedAmount: clearClaimableTokens, newBalance: clearBalance };
  });

/**
 * Refund contribution for failed presale
 * Example: npx hardhat --network sepolia task:refund --presale <ADDRESS> --user 1
 */
task("task:refund", "Refund contribution for failed presale")
  .addParam("presale", "Presale contract address")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addOptionalParam("beneficiary", "Beneficiary address (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Processing refund...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const beneficiary = taskArguments.beneficiary || user.address;

    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get pool state
    const pool = await presale.pool();
    if (Number(pool.state) !== 3) {
      throw new Error(`Presale is not cancelled. Current state: ${pool.state}`);
    }

    // Check if already refunded
    const refunded = await presale.refunded(user.address);
    if (refunded) {
      throw new Error("Contribution already refunded for this user");
    }

    // Get contribution amount
    const contribution = await presale.contributions(user.address);
    const clearContribution = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      contribution.toString(),
      taskArguments.presale,
      user,
    );

    console.log(`Refunding ${clearContribution.toString()} ETH to ${beneficiary}...`);

    // Process refund
    const tx = await presale.connect(user).refund(beneficiary);
    await tx.wait();

    console.log("✅ Refund processed successfully!");
    console.log("Refunded amount:", clearContribution.toString());

    return { refundedAmount: clearContribution };
  });

/**
 * Get presale information
 * Example: npx hardhat --network sepolia task:presale-info --presale <ADDRESS>
 */
task("task:presale-info", "Get presale information")
  .addParam("presale", "Presale contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Getting presale information...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);
    const pool = await presale.pool();

    // Get state description
    let stateDescription = "Unknown";
    switch (Number(pool.state)) {
      case 1:
        stateDescription = "Active";
        break;
      case 2:
        stateDescription = "Waiting for finalize";
        break;
      case 3:
        stateDescription = "Cancelled";
        break;
      case 4:
        stateDescription = "Finalized";
        break;
    }

    console.log("📊 Presale Information:");
    console.log("Address:", taskArguments.presale);
    console.log("State:", pool.state, `(${stateDescription})`);
    console.log("Token address:", pool.token);
    console.log("Confidential token address:", pool.ctoken);
    console.log("cWETH address:", pool.cweth);
    console.log("Wei raised:", formatAmount(pool.weiRaised, 9, hre));
    console.log("Tokens sold:", formatAmount(pool.tokensSold, 18, hre));
    console.log("Token balance:", formatAmount(pool.tokenBalance, 18, hre));
    console.log("Token per ETH:", pool.tokenPerEthWithDecimals.toString());
    console.log("");
    console.log("📋 Presale Options:");
    console.log("Hard cap:", formatAmount(pool.options.hardCap, 9, hre));
    console.log("Soft cap:", formatAmount(pool.options.softCap, 9, hre));
    console.log("Token presale:", formatAmount(pool.options.tokenPresale, 18, hre));
    console.log("Token add liquidity:", formatAmount(pool.options.tokenAddLiquidity, 18, hre));
    console.log("Liquidity percentage:", Number(pool.options.liquidityPercentage) / 100, "%");
    console.log("Start time:", new Date(Number(pool.options.start) * 1000).toISOString());
    console.log("End time:", new Date(Number(pool.options.end) * 1000).toISOString());

    return {
      address: taskArguments.presale,
      state: pool.state,
      stateDescription,
      weiRaised: pool.weiRaised,
      tokensSold: pool.tokensSold,
      options: pool.options,
    };
  });

/**
 * Get user contribution information
 * Example: npx hardhat --network sepolia task:user-info --presale <ADDRESS> --user 1
 */
task("task:user-info", "Get user contribution and claim information")
  .addParam("presale", "Presale contract address")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Getting user information...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get user data
    const [contribution, claimableTokens, claimed, refunded] = await Promise.all([
      presale.contributions(user.address),
      presale.claimableTokens(user.address),
      presale.claimed(user.address),
      presale.refunded(user.address),
    ]);

    // Decrypt encrypted values
    const [clearContribution, clearClaimableTokens] = await Promise.all([
      fhevm.userDecryptEuint(FhevmType.euint64, contribution.toString(), taskArguments.presale, user),
      fhevm.userDecryptEuint(FhevmType.euint64, claimableTokens.toString(), taskArguments.presale, user),
    ]);

    console.log("👤 User Information:");
    console.log("Address:", user.address);
    console.log("Contribution:", clearContribution.toString());
    console.log("Claimable tokens:", clearClaimableTokens.toString());
    console.log("Has claimed:", claimed);
    console.log("Has refunded:", refunded);

    return {
      address: user.address,
      contribution: clearContribution,
      claimableTokens: clearClaimableTokens,
      claimed,
      refunded,
    };
  });

/**
 * Add liquidity to DEX after successful presale
 * Example: npx hardhat --network sepolia task:add-liquidity --presale <ADDRESS> --user 0
 */
task("task:add-liquidity", "Add liquidity to DEX after successful presale")
  .addParam("presale", "Presale contract address")
  .addOptionalParam("user", "User index (0, 1, 2, etc.)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    console.log("Adding liquidity to DEX...");

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const presale = await hre.ethers.getContractAt("PrivacyPresale", taskArguments.presale);

    // Get pool state
    const pool = await presale.pool();
    if (Number(pool.state) !== 4) {
      throw new Error(`Presale is not finalized. Current state: ${pool.state}`);
    }

    // Check if user is the owner
    const owner = await presale.owner();
    if (user.address !== owner) {
      throw new Error(`Only owner can add liquidity. Owner: ${owner}, User: ${user.address}`);
    }

    // Get presale information before adding liquidity
    console.log("📊 Presale state before adding liquidity:");
    console.log("Wei raised:", formatAmount(pool.weiRaised, 18, hre));
    console.log("Tokens sold:", formatAmount(pool.tokensSold, 18, hre));
    console.log("Liquidity percentage:", Number(pool.options.liquidityPercentage) / 100, "%");

    // Calculate expected amounts
    const expectedEthForLiquidity =
      (pool.weiRaised * BigInt(Math.floor(Number(pool.options.liquidityPercentage)))) / 10000n;
    const expectedEthForOwner = pool.weiRaised - expectedEthForLiquidity;

    console.log("Expected ETH for liquidity:", formatAmount(expectedEthForLiquidity, 18, hre));
    console.log("Expected ETH for owner:", formatAmount(expectedEthForOwner, 18, hre));

    // Get contract ETH balance
    const contractBalance = await hre.ethers.provider.getBalance(taskArguments.presale);
    console.log("Contract ETH balance:", formatAmount(contractBalance, 18, hre));

    if (contractBalance < pool.weiRaised) {
      throw new Error(
        `Not enough ETH in contract. Have: ${formatAmount(contractBalance, 18, hre)}, Need: > ${formatAmount(pool.weiRaised, 18, hre)}`,
      );
    }

    // Get token balance for liquidity
    const token = await hre.ethers.getContractAt("IERC20", pool.token);
    const tokenBalance = await token.balanceOf(taskArguments.presale);
    console.log("Token balance for liquidity:", formatAmount(tokenBalance, 18, hre));

    // Add liquidity
    console.log("Executing addLiquidity...");
    const tx = await presale.connect(user).addLiquidity();
    await tx.wait();

    // Get updated pool state
    const poolAfter = await presale.pool();
    console.log("Pool address after adding liquidity:", poolAfter.dex);

    console.log("✅ Liquidity added successfully!");
    console.log("Transaction hash:", tx.hash);
    console.log("DEX pool address:", poolAfter.dex);

    return {
      txHash: tx.hash,
      dexPoolAddress: poolAfter.dex,
      ethForLiquidity: expectedEthForLiquidity,
      ethForOwner: expectedEthForOwner,
      tokenForLiquidity: tokenBalance,
    };
  });

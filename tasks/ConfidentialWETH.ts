import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

/**
 * Helper function to get a signer by index
 */
async function getSigner(hre: HardhatRuntimeEnvironment, index: number) {
  const signers = await hre.ethers.getSigners();
  if (index >= signers.length) {
    throw new Error(`User index ${index} not found. Available users: 0-${signers.length - 1}`);
  }
  return signers[index];
}

/**
 * Helper function to format amounts for display
 */
function formatAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

/**
 * Helper function to parse amounts from user input
 */
function parseAmount(amountStr: string, decimals: number): bigint {
  const parts = amountStr.split(".");
  if (parts.length > 2) {
    throw new Error("Invalid amount format. Use format like '1.5' or '100'");
  }

  const whole = parts[0] || "0";
  const fraction = parts[1] || "";

  if (fraction.length > decimals) {
    throw new Error(`Amount has too many decimal places. Maximum: ${decimals}`);
  }

  const wholeBigInt = BigInt(whole) * 10n ** BigInt(decimals);
  const fractionBigInt = BigInt(fraction.padEnd(decimals, "0"));

  return wholeBigInt + fractionBigInt;
}

/**
 * Deposit ETH to ConfidentialWETH
 * Example: npx hardhat --network sepolia task:cweth-deposit --amount 5 --user 1 --cweth 0x...
 */
task("task:cweth-deposit", "Deposit ETH to ConfidentialWETH")
  .addParam("amount", "Amount of ETH to deposit")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("cweth", "ConfidentialWETH contract address")
  .addOptionalParam("to", "Recipient address (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Depositing ETH to ConfidentialWETH...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const to = taskArguments.to || user.address;
    const amount = parseAmount(taskArguments.amount, 18);

    const cweth = await hre.ethers.getContractAt("ConfidentialWETH", taskArguments.cweth);

    console.log(`Depositing ${formatAmount(amount, 18)} ETH...`);
    console.log("From:", user.address);
    console.log("To:", to);

    // Deposit ETH to cWETH
    const tx = await cweth.connect(user).deposit(to, { value: amount });
    await tx.wait();

    // Get balance after deposit
    const balanceAfter = await cweth.balanceOf(to);
    const clearBalanceAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balanceAfter.toString(),
      taskArguments.cweth,
      user,
    );

    console.log("✅ Deposit completed successfully!");
    console.log("Deposited amount:", formatAmount(amount, 18));
    console.log("Balance after:", formatAmount(clearBalanceAfter, 9));

    return {
      from: user.address,
      to: to,
      depositedAmount: amount,
      newBalance: clearBalanceAfter,
    };
  });

/**
 * Withdraw ETH from ConfidentialWETH
 * Example: npx hardhat --network sepolia task:cweth-withdraw --amount 2 --user 1 --cweth 0x... --to 0x...
 */
task("task:cweth-withdraw", "Withdraw ETH from ConfidentialWETH")
  .addParam("amount", "Amount of cWETH to withdraw")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("cweth", "ConfidentialWETH contract address")
  .addOptionalParam("to", "Recipient address for ETH")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Withdrawing ETH from ConfidentialWETH...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const amount = parseAmount(taskArguments.amount, 9);

    const cweth = await hre.ethers.getContractAt("ConfidentialWETH", taskArguments.cweth);
    const to = taskArguments.to || user.address;

    console.log(`Withdrawing ${formatAmount(amount, 9)} cWETH...`);
    console.log("From:", user.address);
    console.log("To:", to);

    // Check if user has enough cWETH
    const balance = await cweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), taskArguments.cweth, user);

    if (clearBalance < amount) {
      throw new Error(`Insufficient cWETH balance. Have: ${clearBalance}, Need: ${amount}`);
    }

    // Get ETH balance before withdrawal
    const ethBalanceBefore = await hre.ethers.provider.getBalance(to);

    // Create encrypted withdrawal input
    console.log("Creating encrypted withdrawal input...");
    const encrypted = await fhevm.createEncryptedInput(taskArguments.cweth, user.address).add64(amount).encrypt();

    // Withdraw ETH
    console.log("Executing withdrawal...");
    const tx = await cweth
      .connect(user)
      ["withdraw(address,address,bytes32,bytes)"](user.address, to, encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Get ETH balance after withdrawal
    const ethBalanceAfter = await hre.ethers.provider.getBalance(to);

    console.log("✅ Withdrawal completed successfully!");
    console.log("ETH received:", formatAmount(ethBalanceAfter - ethBalanceBefore, 9));

    return {
      from: user.address,
      to: to,
      withdrawnAmount: ethBalanceAfter - ethBalanceBefore,
    };
  });

/**
 * Get ConfidentialWETH balance
 * Example: npx hardhat --network sepolia task:cweth-balance --user 1 --cweth 0x...
 */
task("task:cweth-balance", "Get ConfidentialWETH balance")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("cweth", "ConfidentialWETH contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Getting ConfidentialWETH balance...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    console.log("Initializing FHEVM successfully");

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const cweth = await hre.ethers.getContractAt("ConfidentialWETH", taskArguments.cweth);

    // Get balance
    console.log("Getting ConfidentialWETH balance of user...");
    const balance = await cweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), taskArguments.cweth, user);
    console.log("Cleared balance:", formatAmount(clearBalance, 9));

    console.log("👤 ConfidentialWETH Balance:");
    console.log("User address:", user.address);
    console.log("Balance:", formatAmount(clearBalance, 9));

    return {
      address: user.address,
      balance: clearBalance,
    };
  });

/**
 * Get ConfidentialWETH contract information
 * Example: npx hardhat --network sepolia task:cweth-info --cweth 0x...
 */
task("task:cweth-info", "Get ConfidentialWETH contract information")
  .addParam("cweth", "ConfidentialWETH contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    console.log("Getting ConfidentialWETH contract information...");

    const cweth = await hre.ethers.getContractAt("ConfidentialWETH", taskArguments.cweth);

    // Get contract info
    const [name, symbol, decimals, rate] = await Promise.all([
      cweth.name(),
      cweth.symbol(),
      cweth.decimals(),
      cweth.rate(),
    ]);

    console.log("📊 ConfidentialWETH Contract Information:");
    console.log("Address:", taskArguments.cweth);
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals);
    console.log("Rate:", rate.toString());
    console.log("Rate explanation: 1 cWETH =", formatAmount(rate, 9), "ETH");

    return {
      address: taskArguments.cweth,
      name,
      symbol,
      decimals,
      rate,
    };
  });

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
 * Wrap underlying ERC20 tokens into confidential tokens
 * Example: npx hardhat --network sepolia task:ctoken-wrap --amount 100 --user 1 --ctoken 0x... --to 0x...
 */
task("task:ctoken-wrap", "Wrap underlying ERC20 tokens into confidential tokens")
  .addParam("amount", "Amount of underlying tokens to wrap")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("ctoken", "ConfidentialTokenWrapper contract address")
  .addOptionalParam("to", "Recipient address for confidential tokens (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    console.log("Wrapping underlying tokens into confidential tokens...");

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const to = taskArguments.to || user.address;
    const amount = parseAmount(taskArguments.amount, 18); // Assuming 18 decimals for underlying token

    const ctoken = await hre.ethers.getContractAt("ConfidentialTokenWrapper", taskArguments.ctoken);

    // Get underlying token address and contract
    const underlyingAddress = await ctoken.underlying();
    const underlying = await hre.ethers.getContractAt("IERC20", underlyingAddress);

    // Get rate for conversion
    const rate = await ctoken.rate();
    const decimals = await ctoken.decimals();

    console.log(`Wrapping ${formatAmount(amount, 18)} underlying tokens...`);
    console.log("From:", user.address);
    console.log("To:", to);
    console.log("Rate:", rate.toString());
    console.log("Expected confidential tokens:", formatAmount(amount / rate, Number(decimals)));

    // Check if user has enough underlying tokens
    const underlyingBalance = await underlying.balanceOf(user.address);
    if (underlyingBalance < amount) {
      throw new Error(
        `Insufficient underlying token balance. Have: ${formatAmount(underlyingBalance, 18)}, Need: ${formatAmount(amount, 18)}`,
      );
    }

    // Check allowance
    const allowance = await underlying.allowance(user.address, taskArguments.ctoken);
    if (allowance < amount) {
      console.log("Approving underlying tokens for wrapper contract...");
      const approveTx = await underlying.connect(user).approve(taskArguments.ctoken, amount);
      await approveTx.wait();
      console.log("✅ Approval completed");
    }

    // Wrap tokens
    console.log("Executing wrap...");
    const tx = await ctoken.connect(user).wrap(to, amount);
    await tx.wait();

    // Get confidential token balance after wrap
    const balanceAfter = await ctoken.balanceOf(to);

    console.log("✅ Wrap completed successfully!");
    console.log("Wrapped amount:", formatAmount(amount, 18));
    console.log("Confidential tokens received:", formatAmount(BigInt(balanceAfter), Number(decimals)));

    return {
      from: user.address,
      to: to,
      wrappedAmount: amount,
      confidentialTokensReceived: balanceAfter,
      rate: rate,
    };
  });

/**
 * Unwrap confidential tokens back to underlying ERC20 tokens
 * Example: npx hardhat --network sepolia task:ctoken-unwrap --amount 10 --user 1 --ctoken 0x... --to 0x...
 */
task("task:ctoken-unwrap", "Unwrap confidential tokens back to underlying ERC20 tokens")
  .addParam("amount", "Amount of confidential tokens to unwrap")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("ctoken", "ConfidentialTokenWrapper contract address")
  .addOptionalParam("to", "Recipient address for underlying tokens (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Unwrapping confidential tokens to underlying tokens...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const to = taskArguments.to || user.address;
    const amount = parseAmount(taskArguments.amount, 9); // Assuming 9 decimals for confidential tokens

    const ctoken = await hre.ethers.getContractAt("ConfidentialTokenWrapper", taskArguments.ctoken);

    // Get underlying token address and contract
    const underlyingAddress = await ctoken.underlying();
    const underlying = await hre.ethers.getContractAt("IERC20", underlyingAddress);

    // Get rate for conversion
    const rate = await ctoken.rate();
    const decimals = await ctoken.decimals();

    console.log(`Unwrapping ${formatAmount(amount, Number(decimals))} confidential tokens...`);
    console.log("From:", user.address);
    console.log("To:", to);
    console.log("Rate:", rate.toString());
    console.log("Expected underlying tokens:", formatAmount(amount * rate, 18));

    // Check if user has enough confidential tokens
    const balance = await ctoken.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance.toString(),
      taskArguments.ctoken,
      user,
    );

    if (clearBalance < amount) {
      throw new Error(
        `Insufficient confidential token balance. Have: ${formatAmount(clearBalance, Number(decimals))}, Need: ${formatAmount(amount, Number(decimals))}`,
      );
    }

    // Get underlying token balance before unwrap
    const underlyingBalanceBefore = await underlying.balanceOf(to);

    // Create encrypted unwrap input
    console.log("Creating encrypted unwrap input...");
    const encrypted = await fhevm.createEncryptedInput(taskArguments.ctoken, user.address).add64(amount).encrypt();

    // Unwrap tokens
    console.log("Executing unwrap...");
    const tx = await ctoken
      .connect(user)
      ["unwrap(address,address,bytes32,bytes)"](user.address, to, encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Get underlying token balance after unwrap
    const underlyingBalanceAfter = await underlying.balanceOf(to);

    console.log("✅ Unwrap completed successfully!");
    console.log("Underlying tokens received:", formatAmount(underlyingBalanceAfter - underlyingBalanceBefore, 18));

    return {
      from: user.address,
      to: to,
      unwrappedAmount: underlyingBalanceAfter - underlyingBalanceBefore,
      confidentialTokensBurned: amount,
      rate: rate,
    };
  });

/**
 * Get confidential token balance
 * Example: npx hardhat --network sepolia task:ctoken-balance --user 1 --ctoken 0x...
 */
task("task:ctoken-balance", "Get confidential token balance")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("ctoken", "ConfidentialTokenWrapper contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Getting confidential token balance...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const ctoken = await hre.ethers.getContractAt("ConfidentialTokenWrapper", taskArguments.ctoken);

    // Get balance
    console.log("Getting confidential token balance of user...");
    const balance = await ctoken.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance.toString(),
      taskArguments.ctoken,
      user,
    );

    // Get contract info for display
    const [name, symbol, decimals, rate, underlyingAddress] = await Promise.all([
      ctoken.name(),
      ctoken.symbol(),
      ctoken.decimals(),
      ctoken.rate(),
      ctoken.underlying(),
    ]);

    console.log("👤 Confidential Token Balance:");
    console.log("User address:", user.address);
    console.log("Token name:", name);
    console.log("Token symbol:", symbol);
    console.log("Decimals:", decimals);
    console.log("Balance:", formatAmount(clearBalance, Number(decimals)), symbol);
    console.log("Underlying token:", underlyingAddress);

    return {
      address: user.address,
      balance: clearBalance,
      name: name,
      symbol: symbol,
      decimals: decimals,
      rate: rate,
      underlying: underlyingAddress,
    };
  });

/**
 * Transfer confidential tokens between addresses
 * Example: npx hardhat --network sepolia task:ctoken-transfer --amount 5 --from 1 --to 0x... --ctoken 0x...
 */
task("task:ctoken-transfer", "Transfer confidential tokens between addresses")
  .addParam("amount", "Amount of confidential tokens to transfer")
  .addParam("from", "Sender user index (0, 1, 2, etc.)")
  .addParam("to", "Recipient address")
  .addParam("ctoken", "ConfidentialTokenWrapper contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Transferring confidential tokens...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const fromUser = await getSigner(hre, parseInt(taskArguments.from));
    const toAddress = taskArguments.to;
    const amount = parseAmount(taskArguments.amount, 9); // Assuming 9 decimals for confidential tokens

    const ctoken = await hre.ethers.getContractAt("ConfidentialTokenWrapper", taskArguments.ctoken);

    // Get contract info
    const [symbol, decimals] = await Promise.all([ctoken.symbol(), ctoken.decimals()]);

    console.log(`Transferring ${formatAmount(amount, Number(decimals))} ${symbol}...`);
    console.log("From:", fromUser.address);
    console.log("To:", toAddress);

    // Create encrypted transfer input
    console.log("Creating encrypted transfer input...");
    const encrypted = await fhevm.createEncryptedInput(taskArguments.ctoken, fromUser.address).add64(amount).encrypt();

    // Transfer tokens
    console.log("Executing transfer...");
    const tx = await ctoken
      .connect(fromUser)
      ["confidentialTransfer(address,bytes32,bytes)"](toAddress, encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Get balances after transfer
    const fromBalanceAfter = await ctoken.balanceOf(fromUser.address);

    const fromClearBalanceAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      fromBalanceAfter.toString(),
      taskArguments.ctoken,
      fromUser,
    );

    console.log("✅ Transfer completed successfully!");
    console.log("Transferred amount:", formatAmount(amount, Number(decimals)));
    console.log("Sender new balance:", formatAmount(fromClearBalanceAfter, Number(decimals)));

    return {
      from: fromUser.address,
      to: toAddress,
      transferredAmount: amount,
      senderNewBalance: fromClearBalanceAfter,
    };
  });

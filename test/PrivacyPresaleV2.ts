import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Log } from "ethers";
import { ethers, fhevm, network } from "hardhat";

import { IERC20, IERC20__factory } from "../types";
import { ConfidentialTokenWrapper, ConfidentialWETH, PrivacyPresale, PrivacyPresaleFactory } from "../types/contracts";
import {
  ConfidentialTokenWrapper__factory,
  ConfidentialWETH__factory,
  PrivacyPresaleFactory__factory,
  PrivacyPresale__factory,
} from "../types/factories/contracts";

// Constants for better maintainability
const TIME_INCREASE = 7200; // 2 hours
const PRESALE_DURATION = 3600; // 1 hour
const PRESALE_START_OFFSET = 60; // 1 minute ago
const OPERATOR_EXPIRY_OFFSET = 1000; // 1000 seconds from now

const PURCHASE_AMOUNTS = {
  alice1: ethers.parseUnits("0.1", 9),
  alice2: ethers.parseUnits("0.5", 9),
  alice3: ethers.parseUnits("0.1", 9),
  alice4: ethers.parseUnits("3", 9),
  alice5: ethers.parseUnits("1.4", 9),
} as const;

// Presale configuration constants
const PRESALE_CONFIG = {
  hardCap: ethers.parseUnits("10", 9), // 10 ETH
  softCap: ethers.parseUnits("6", 9), // 6 ETH
  maxContribution: ethers.parseUnits("2", 9), // max 2
  minContribution: ethers.parseUnits("0.5", 9), // min 0.5
  tokenPresale: ethers.parseUnits("1000000000", 18), // 1_000_000_000
  tokenAddLiquidity: ethers.parseUnits("1000000000", 18), // 1_000_000_000
  liquidityPercentage: BigInt(5000), // 50%
} as const;

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

// Helper functions to reduce code duplication and improve performance
class TestHelpers {
  /**
   * Wraps ETH to cWETH for a user
   */
  static async wrapETH(user: HardhatEthersSigner, amount: bigint, cweth: ConfidentialWETH) {
    // Only wrap if amount is greater than 0
    if (amount > 0n) {
      const wrapAmount = amount * 10n ** 9n;
      await cweth.connect(user).deposit(user.address, { value: wrapAmount });
    }

    const balance = await cweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), cweth.target, user);
    return { balance, clearBalance };
  }

  /**
   * Approves cWETH spending for presale contract
   */
  static async approveCWETH(user: HardhatEthersSigner, presaleAddress: string, cweth: ConfidentialWETH) {
    await cweth.connect(user).setOperator(presaleAddress, BigInt((await time.latest()) + OPERATOR_EXPIRY_OFFSET));
  }

  /**
   * Creates encrypted input for purchase
   */
  static async createEncryptedPurchase(presaleAddress: string, user: HardhatEthersSigner, amount: bigint) {
    return await fhevm.createEncryptedInput(presaleAddress, user.address).add64(amount).encrypt();
  }

  /**
   * Performs a purchase and returns contribution and claimable tokens
   */
  static async performPurchase(
    presale: PrivacyPresale,
    user: HardhatEthersSigner,
    amount: bigint,
    presaleAddress: string,
  ) {
    const encrypted = await this.createEncryptedPurchase(presaleAddress, user, amount);

    await presale.connect(user).purchase(user.address, encrypted.handles[0], encrypted.inputProof);

    // Wait for FHEVM to process the transaction
    await fhevm.awaitDecryptionOracle();

    // Get contribution and claimable tokens in parallel for better performance
    const [contribution, claimableTokens] = await Promise.all([
      presale.contributions(user.address),
      presale.claimableTokens(user.address),
    ]);

    const [clearContribution, clearClaimableTokens] = await Promise.all([
      fhevm.userDecryptEuint(FhevmType.euint64, contribution.toString(), presaleAddress, user),
      fhevm.userDecryptEuint(FhevmType.euint64, claimableTokens.toString(), presaleAddress, user),
    ]);

    return { clearContribution, clearClaimableTokens };
  }

  /**
   * Claims tokens and returns the balance
   */
  static async claimTokens(presale: PrivacyPresale, user: HardhatEthersSigner, ctoken: ConfidentialTokenWrapper) {
    await presale.connect(user).claimTokens(user.address);

    const balance = await ctoken.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance.toString(),
      await ctoken.getAddress(),
      user,
    );
    return clearBalance;
  }

  /**
   * Calculates expected contribution based on hard cap
   */
  static calculateExpectedContribution(
    purchaseAmount: bigint,
    beforePurchased: bigint,
    hardCap: bigint,
  ): { contribution: bigint; actualPurchased: bigint } {
    const totalAfterPurchase = beforePurchased + purchaseAmount;

    if (totalAfterPurchase > hardCap) {
      const contribution = hardCap - beforePurchased;
      return { contribution, actualPurchased: contribution };
    } else {
      return { contribution: purchaseAmount, actualPurchased: purchaseAmount };
    }
  }

  /**
   * Advances time and requests finalization
   */
  static async finalizePresale(presale: PrivacyPresale, user: HardhatEthersSigner) {
    await network.provider.send("evm_increaseTime", [TIME_INCREASE]);
    await presale.connect(user).requestFinalizePresaleState();
  }

  /**
   * Waits for decryption and validates final state
   */
  static async validateFinalization(
    presale: PrivacyPresale,
    expectedState: number,
    expectedWeiRaised: bigint,
    expectedTokensSold: bigint,
  ) {
    await fhevm.awaitDecryptionOracle();

    const pool = await presale.pool();
    expect(pool.state).to.eq(expectedState);
    expect(pool.weiRaised).to.eq(expectedWeiRaised);
    expect(pool.tokensSold).to.eq(expectedTokensSold);

    return pool;
  }
}

describe("PrivacyPresale integration flow", function () {
  // Cached variables for better performance
  let signers: Signers;
  let cweth: ConfidentialWETH;
  let factory: PrivacyPresaleFactory;
  let presale: PrivacyPresale;
  let presaleAddress: string;
  let purchased: bigint;
  let token: IERC20;
  let ctoken: ConfidentialTokenWrapper;
  let now: number;

  // Cached contract addresses for better performance
  let cwethAddress: string;
  let ctokenAddress: string;
  let tokenAddress: string;

  /**
   * Optimized setup function with better error handling and performance
   */
  async function setupPresale() {
    // Validate FHEVM environment
    if (!fhevm.isMock) {
      throw new Error("This hardhat test suite cannot run on Sepolia Testnet");
    }

    purchased = 0n;

    // Deploy ConfidentialWETH with better error handling
    cweth = (await (
      await new ConfidentialWETH__factory(signers.deployer).deploy()
    ).waitForDeployment()) as ConfidentialWETH;
    cwethAddress = await cweth.getAddress();

    // Deploy PrivacyPresaleLib library
    const purchaseLib = await (await ethers.deployContract("PrivacyPresaleLib")).waitForDeployment();
    const purchaseLibAddress = await purchaseLib.getAddress();

    // Deploy PrivacyPresaleFactory with cached library address
    factory = (await (
      await new PrivacyPresaleFactory__factory(
        {
          "contracts/libraries/PrivacyPresaleLib.sol:PrivacyPresaleLib": purchaseLibAddress,
        },
        signers.deployer,
      ).deploy(cwethAddress)
    ).waitForDeployment()) as PrivacyPresaleFactory;

    // Cache current time for better performance
    now = await time.latest();

    // Create presale options with cached constants
    const presaleOptions = {
      tokenAddLiquidity: PRESALE_CONFIG.tokenAddLiquidity,
      tokenPresale: PRESALE_CONFIG.tokenPresale,
      liquidityPercentage: PRESALE_CONFIG.liquidityPercentage,
      hardCap: PRESALE_CONFIG.hardCap,
      softCap: PRESALE_CONFIG.softCap,
      maxContribution: PRESALE_CONFIG.maxContribution,
      minContribution: PRESALE_CONFIG.minContribution,
      start: BigInt(now - PRESALE_START_OFFSET),
      end: BigInt(now + PRESALE_DURATION),
    };

    // Create presale with better error handling
    const tx = await factory.createPrivacyPresaleWithNewToken(
      "TestToken",
      "TTK",
      PRESALE_CONFIG.tokenAddLiquidity + PRESALE_CONFIG.tokenPresale,
      presaleOptions,
    );

    const receipt = await tx.wait();

    // Extract presale address from event with better error handling
    type PrivacyPresaleCreatedEvent = {
      name: string;
      args: { presale: string };
    };

    const event = receipt?.logs
      .map((log: unknown) => {
        try {
          return factory.interface.parseLog(log as Log) as unknown as PrivacyPresaleCreatedEvent;
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "PrivacyPresaleCreated") as PrivacyPresaleCreatedEvent | null;

    presaleAddress = event?.args?.presale ?? "";
    if (!presaleAddress) {
      throw new Error("Failed to extract presale address from deployment event");
    }

    // Connect to contracts with cached addresses
    presale = PrivacyPresale__factory.connect(presaleAddress, signers.deployer) as PrivacyPresale;
    const pool = await presale.pool();

    ctoken = ConfidentialTokenWrapper__factory.connect(pool.ctoken, signers.deployer) as ConfidentialTokenWrapper;
    token = IERC20__factory.connect(pool.token, signers.deployer) as IERC20;

    // Cache addresses for better performance
    ctokenAddress = await ctoken.getAddress();
    tokenAddress = await token.getAddress();

    // Log setup information
    console.table({
      "token address": tokenAddress,
      "cweth address": cwethAddress,
      "presale address": presaleAddress,
      "ctoken address": ctokenAddress,
    });
  }

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
    };

    console.table({
      deployer: signers.deployer.address,
      alice: signers.alice.address,
    });
  });

  describe("Test max/min contribution with alice", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap ETH for Alice", async function () {
      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, ethers.parseUnits("100", 9), cweth);
      expect(clearBalance).to.eq(ethers.parseUnits("100", 9));
    });

    it("Test Alice's purchase with lower than min contribution", async function () {
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, cweth);

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice1,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(0);
    });

    it("Test Alice's purchase with equal min contribution", async function () {
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, cweth);

      purchased += PURCHASE_AMOUNTS.alice2;

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice2,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(purchased);
    });

    it("Test Alice's purchase with lower than min contribution again: should be able", async function () {
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, cweth);

      purchased += PURCHASE_AMOUNTS.alice3;

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice3,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(purchased);
    });

    it("Test Alice's purchase with greater than max contribution", async function () {
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, cweth);

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice4,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(PRESALE_CONFIG.maxContribution);
    });

    it("Test request finalize presale", async function () {
      await TestHelpers.finalizePresale(presale, signers.alice);
    });
  });
});

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Log } from "ethers";
import { ConfidentialWETH, PrivacyPresaleFactory, PrivacyPresale, ConfidentialTokenWrapper } from "../types/contracts";
import {
  ConfidentialTokenWrapper__factory,
  ConfidentialWETH__factory,
  PrivacyPresaleFactory__factory,
  PrivacyPresale__factory,
} from "../types/factories/contracts";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { IERC20, IERC20__factory } from "../types";

// Dummy Uniswap router address for local test
const DUMMY_UNISWAP_ROUTER = "0x000000000000000000000000000000000000dEaD";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner;
};

describe("PrivacyPresale integration flow", function () {
  let signers: Signers;
  let cweth: ConfidentialWETH;
  let factory: PrivacyPresaleFactory;
  let presale: PrivacyPresale;
  let presaleAddress: string;
  let purchased: bigint;
  let hardCap: bigint;
  let softCap: bigint;
  let tokenPerEth: bigint;
  let tokenPresale: bigint;
  let tokenAddLiquidity: bigint;
  let token: IERC20; // Removed unused variable to fix linter error
  let ctoken: ConfidentialTokenWrapper;
  let now: number;
  let aliceActualPurchased: bigint;
  let bobActualPurchased: bigint;
  let charlieActualPurchased: bigint;

  // Define purchase amounts as global variables for each user
  const alicePurchaseAmount = ethers.parseUnits("1", 9); // 1 ETH
  const bobPurchaseAmount = ethers.parseUnits("10", 9); // 10 ETH
  const charliePurchaseAmount = ethers.parseUnits("5", 9); // 5 ETH

  // Helper function to setup presale state for each describe
  async function setupPresale() {
    // Check FHEVM mock
    if (!fhevm.isMock) {
      throw new Error("This hardhat test suite cannot run on Sepolia Testnet");
    }
    purchased = 0n;

    // 1. Deploy ConfidentialWETH
    cweth = (await (
      await new ConfidentialWETH__factory(signers.deployer).deploy()
    ).waitForDeployment()) as ConfidentialWETH;

    // Deploy the libraries
    const purchaseLib = await (await ethers.deployContract("PrivacyPresaleLib")).waitForDeployment();
    const purchaseLibAddress = await purchaseLib.getAddress();

    // 2. Deploy PrivacyPresaleFactory
    factory = (await (
      await new PrivacyPresaleFactory__factory(
        {
          "contracts/PrivacyPresaleLib.sol:PrivacyPresaleLib": purchaseLibAddress,
        },
        signers.deployer,
      ).deploy(await cweth.getAddress(), DUMMY_UNISWAP_ROUTER)
    ).waitForDeployment()) as PrivacyPresaleFactory;

    hardCap = ethers.parseUnits("10", 9); // 10 ETH
    softCap = ethers.parseUnits("6", 9); // 6 ETH
    tokenPresale = ethers.parseUnits("1000000000", 18); // 1_000_000_000
    tokenAddLiquidity = ethers.parseUnits("1000000000", 18); // 1_000_000_000
    // 3. Create a new PrivacyPresale with a new token
    now = await time.latest();
    const presaleOptions = {
      tokenAddLiquidity, // in token decimal
      tokenPresale, // in token decimal
      hardCap, // 10 ETH
      softCap, // 6 ETH
      start: BigInt(now - 60), // started 1 min ago
      end: BigInt(now + 3600), // ends in 1 hour
    };

    tokenPerEth = tokenPresale / BigInt(10 ** 9) / hardCap;

    const tx = await factory.createPrivacyPresaleWithNewToken(
      "TestToken",
      "TTK",
      tokenAddLiquidity + tokenPresale,
      presaleOptions,
    );
    const receipt = await tx.wait();
    // Get the PrivacyPresale address from the event
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
    expect(presaleAddress).to.equal(presaleAddress);
    presale = PrivacyPresale__factory.connect(presaleAddress, signers.deployer) as PrivacyPresale;
    const pool = await presale.pool();
    ctoken = ConfidentialTokenWrapper__factory.connect(pool.ctoken, signers.deployer) as ConfidentialTokenWrapper;
    token = IERC20__factory.connect(pool.token, signers.deployer) as IERC20;
    console.table({
      // presale contract addresses
      "token address": await token.getAddress(),
      "cweth address": await cweth.getAddress(),
      "presale address": presaleAddress,
      "ctoken address": await ctoken.getAddress(),
    });
  }

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], charlie: ethSigners[3] };
    console.table({
      deployer: signers.deployer.address,
      alice: signers.alice.address,
      bob: signers.bob.address,
      charlie: signers.charlie.address,
    });
  });

  describe("Test happy case: can be finalized", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap", async function () {
      // alice wrap
      const wrapAmount = alicePurchaseAmount * 10n ** 9n;
      const clearWrapAmount = alicePurchaseAmount;
      await cweth.connect(signers.alice).deposit(signers.alice.address, { value: wrapAmount });
      const aliceCwethBalance = await cweth.balanceOf(signers.alice.address);
      const clearAliceCwethBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceCwethBalance.toString(),
        cweth.target,
        signers.alice,
      );
      expect(clearAliceCwethBalance).to.eq(clearWrapAmount);
    });

    it("Test purchase alice", async function () {
      // alice approve cweth
      await cweth.connect(signers.alice).setOperator(presaleAddress, BigInt(now + 1000));

      // 5. Alice purchases in the presale using cweth
      // Encrypt alicePurchaseAmount (in 9 decimals, as required by the contract)
      aliceActualPurchased = alicePurchaseAmount;
      purchased += aliceActualPurchased;
      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.alice.address)
        .add64(alicePurchaseAmount)
        .encrypt();

      await presale.connect(signers.alice).purchase(signers.alice.address, encrypted.handles[0], encrypted.inputProof);

      // Check Alice's contribution is nonzero
      const contribution = await presale.contributions(signers.alice.address);
      const clearAliceCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice contribution: ", clearAliceCwethContribution);
      expect(clearAliceCwethContribution).to.eq(alicePurchaseAmount);

      const claimableTokens = await presale.claimableTokens(signers.alice.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(alicePurchaseAmount * tokenPerEth);
    });

    it("Test purchase bob, bob purchase more then hard cap", async function () {
      // bob wrap
      const wrapAmount = ethers.parseUnits("100", 18); // 100 ETH
      await cweth.connect(signers.bob).deposit(signers.bob.address, { value: wrapAmount });

      // alice approve cweth
      await cweth.connect(signers.bob).setOperator(presaleAddress, BigInt(now + 1000));

      // 5. Bob purchases in the presale using cweth
      // Encrypt bobPurchaseAmount (in 9 decimals, as required by the contract)
      const beforePurchased = purchased;
      purchased += bobPurchaseAmount;

      let contributionShouldBe = 0n;

      if (purchased > hardCap) {
        contributionShouldBe = hardCap - beforePurchased;
        purchased = hardCap;
        bobActualPurchased = hardCap - beforePurchased;
      } else {
        contributionShouldBe = bobPurchaseAmount;
        bobActualPurchased = bobPurchaseAmount;
      }

      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.bob.address)
        .add64(bobPurchaseAmount)
        .encrypt();

      await presale.connect(signers.bob).purchase(signers.bob.address, encrypted.handles[0], encrypted.inputProof);

      // Check Alice's contribution is nonzero
      const contribution = await presale.contributions(signers.bob.address);
      const clearBobCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.bob,
      );
      console.log("bob contribution: ", clearBobCwethContribution);
      expect(clearBobCwethContribution).to.eq(contributionShouldBe);

      const claimableTokens = await presale.claimableTokens(signers.bob.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.bob,
      );
      console.log("bob claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test purchase charlie, but charlie can't not purchase anymore", async function () {
      // charlie wrap
      const wrapAmount = ethers.parseUnits("100", 18); // 100 ETH
      await cweth.connect(signers.charlie).deposit(signers.charlie.address, { value: wrapAmount });

      // charlie approve cweth
      await cweth.connect(signers.charlie).setOperator(presaleAddress, BigInt(now + 1000));

      // 5. Charlie purchases in the presale using cweth
      // Encrypt charliePurchaseAmount (in 9 decimals, as required by the contract)
      const beforePurchased = purchased;
      purchased += charliePurchaseAmount;

      let contributionShouldBe = 0n;

      if (purchased > hardCap) {
        contributionShouldBe = hardCap - beforePurchased;
        charlieActualPurchased = hardCap - beforePurchased;
      } else {
        contributionShouldBe = charliePurchaseAmount;
        charlieActualPurchased = charliePurchaseAmount;
      }

      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.charlie.address)
        .add64(charliePurchaseAmount)
        .encrypt();

      await presale
        .connect(signers.charlie)
        .purchase(signers.charlie.address, encrypted.handles[0], encrypted.inputProof);

      // Check Charlie's contribution is zero
      const contribution = await presale.contributions(signers.charlie.address);
      const clearCharlieCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.charlie,
      );
      console.log("charlie contribution: ", clearCharlieCwethContribution);
      expect(clearCharlieCwethContribution).to.eq(contributionShouldBe);

      const claimableTokens = await presale.claimableTokens(signers.charlie.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.charlie,
      );
      console.log("charlie claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      // increase time in hardhat
      await network.provider.send("evm_increaseTime", [7200]);

      // alice finalize presale
      await presale.connect(signers.alice).requestFinalizePresaleState();
    });

    it("Test finalize presale", async function () {
      // Use the built-in `awaitDecryptionOracle` helper to wait for the FHEVM decryption oracle
      // to complete all pending Solidity decryption requests.
      await fhevm.awaitDecryptionOracle();

      // get presale state
      const pool = await presale.pool();
      expect(pool.state).to.eq(4);
      expect(pool.weiRaised).to.eq(hardCap * 10n ** 9n);
      expect(pool.tokensSold).to.eq(BigInt(tokenPresale));
    });

    it("Test alice claim tokens", async function () {
      // alice clamble token
      const aliceClaimableTokens = aliceActualPurchased * tokenPerEth;

      // alice claim tokens
      await presale.connect(signers.alice).claimTokens(signers.alice.address);

      // check alice's token balance
      const aliceTokenBalance = await ctoken.balanceOf(signers.alice.address);
      const clearAliceTokenBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceTokenBalance.toString(),
        await ctoken.getAddress(),
        signers.alice,
      );
      expect(clearAliceTokenBalance).to.eq(aliceClaimableTokens);
    });

    it("Test claim tokens again", async function () {
      // expect revert
      await expect(presale.connect(signers.alice).claimTokens(signers.alice.address)).to.be.revertedWith(
        "Already claimed",
      );
    });

    it("test claim charlie token", async function () {
      // charlie claim tokens
      await presale.connect(signers.charlie).claimTokens(signers.charlie.address);

      // check charlie's token balance
      const charlieTokenBalance = await ctoken.balanceOf(signers.charlie.address);
      const clearCharlieTokenBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        charlieTokenBalance.toString(),
        await ctoken.getAddress(),
        signers.charlie,
      );
      expect(clearCharlieTokenBalance).to.eq(0n);
    });

    it("test claim bob token", async function () {
      // bob clamble token
      const bobClaimableTokens = bobActualPurchased * tokenPerEth;

      // bob claim tokens
      await presale.connect(signers.bob).claimTokens(signers.bob.address);

      // check bob's token balance
      const bobTokenBalance = await ctoken.balanceOf(signers.bob.address);
      const clearBobTokenBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        bobTokenBalance.toString(),
        await ctoken.getAddress(),
        signers.bob,
      );
      expect(clearBobTokenBalance).to.eq(bobClaimableTokens);
    });
  });

  describe("Test sad case: only alice buy -> pool is cancelled", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap", async function () {
      // alice wrap
      const wrapAmount = alicePurchaseAmount * 10n ** 9n;
      const clearWrapAmount = alicePurchaseAmount;
      await cweth.connect(signers.alice).deposit(signers.alice.address, { value: wrapAmount });
      const aliceCwethBalance = await cweth.balanceOf(signers.alice.address);
      const clearAliceCwethBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceCwethBalance.toString(),
        cweth.target,
        signers.alice,
      );
      expect(clearAliceCwethBalance).to.eq(clearWrapAmount);
    });

    it("Test purchase alice", async function () {
      // alice approve cweth
      await cweth.connect(signers.alice).setOperator(presaleAddress, BigInt(now + 1000));

      // alice purchase
      purchased += alicePurchaseAmount;
      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.alice.address)
        .add64(alicePurchaseAmount)
        .encrypt();

      await presale.connect(signers.alice).purchase(signers.alice.address, encrypted.handles[0], encrypted.inputProof);

      // Check Alice's contribution is nonzero
      const contribution = await presale.contributions(signers.alice.address);
      const clearAliceCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice contribution: ", clearAliceCwethContribution);
      expect(clearAliceCwethContribution).to.eq(alicePurchaseAmount);

      const claimableTokens = await presale.claimableTokens(signers.alice.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(alicePurchaseAmount * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      // increase time in hardhat
      await network.provider.send("evm_increaseTime", [7200]);

      // alice finalize presale
      await presale.connect(signers.alice).requestFinalizePresaleState();
    });

    it("Test finalize presale", async function () {
      // Use the built-in `awaitDecryptionOracle` helper to wait for the FHEVM decryption oracle
      // to complete all pending Solidity decryption requests.
      await fhevm.awaitDecryptionOracle();

      // get presale state
      const pool = await presale.pool();
      expect(pool.state).to.eq(3);
      expect(pool.weiRaised).to.eq(alicePurchaseAmount * 10n ** 9n);
      expect(pool.tokensSold).to.eq(alicePurchaseAmount * tokenPerEth * 10n ** 9n);
    });

    it("Test claim tokens", async function () {
      // alice claim tokens
      // expect revert
      await expect(presale.connect(signers.alice).claimTokens(signers.alice.address)).to.be.revertedWith(
        "Invalid state",
      );
    });

    it("Test refund alice", async function () {
      // alice refund
      await presale.connect(signers.alice).refund(signers.alice.address);

      // check alice's cweth balance
      const aliceCwethBalance = await cweth.balanceOf(signers.alice.address);
      const clearAliceCwethBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceCwethBalance.toString(),
        cweth.target,
        signers.alice,
      );
      expect(clearAliceCwethBalance).to.eq(alicePurchaseAmount);
    });

    it("Test refund alice again", async function () {
      // expect revert
      await expect(presale.connect(signers.alice).refund(signers.alice.address)).to.be.revertedWith("Already refunded");
    });
  });

  describe("Test mid case: only alice, charlie buy -> pool is soft cap", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap", async function () {
      // alice wrap
      const wrapAmount = alicePurchaseAmount * 10n ** 9n;
      const clearWrapAmount = alicePurchaseAmount;
      await cweth.connect(signers.alice).deposit(signers.alice.address, { value: wrapAmount });
      const aliceCwethBalance = await cweth.balanceOf(signers.alice.address);
      const clearAliceCwethBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceCwethBalance.toString(),
        cweth.target,
        signers.alice,
      );
      expect(clearAliceCwethBalance).to.eq(clearWrapAmount);
    });

    it("Test purchase alice", async function () {
      // alice approve cweth
      await cweth.connect(signers.alice).setOperator(presaleAddress, BigInt(now + 1000));

      // alice purchase
      purchased += alicePurchaseAmount;
      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.alice.address)
        .add64(alicePurchaseAmount)
        .encrypt();

      await presale.connect(signers.alice).purchase(signers.alice.address, encrypted.handles[0], encrypted.inputProof);

      // Check Alice's contribution is nonzero
      const contribution = await presale.contributions(signers.alice.address);
      const clearAliceCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice contribution: ", clearAliceCwethContribution);
      expect(clearAliceCwethContribution).to.eq(alicePurchaseAmount);

      const claimableTokens = await presale.claimableTokens(signers.alice.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.alice,
      );
      console.log("alice claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(alicePurchaseAmount * tokenPerEth);
    });

    it("Test purchase charlie", async function () {
      // charlie wrap
      const wrapAmount = charliePurchaseAmount * 10n ** 9n;
      await cweth.connect(signers.charlie).deposit(signers.charlie.address, { value: wrapAmount });

      // charlie approve cweth
      await cweth.connect(signers.charlie).setOperator(presaleAddress, BigInt(now + 1000));

      // charlie purchase
      const beforePurchased = purchased;
      purchased += charliePurchaseAmount;

      let contributionShouldBe = 0n;

      if (purchased > hardCap) {
        contributionShouldBe = hardCap - beforePurchased;
        charlieActualPurchased = hardCap - beforePurchased;
      } else {
        contributionShouldBe = charliePurchaseAmount;
        charlieActualPurchased = charliePurchaseAmount;
      }

      const encrypted = await fhevm
        .createEncryptedInput(presaleAddress, signers.charlie.address)
        .add64(charliePurchaseAmount)
        .encrypt();

      await presale
        .connect(signers.charlie)
        .purchase(signers.charlie.address, encrypted.handles[0], encrypted.inputProof);

      // Check Charlie's contribution is zero
      const contribution = await presale.contributions(signers.charlie.address);
      const clearCharlieCwethContribution = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        contribution.toString(),
        presaleAddress,
        signers.charlie,
      );
      console.log("charlie contribution: ", clearCharlieCwethContribution);
      expect(clearCharlieCwethContribution).to.eq(contributionShouldBe);

      const claimableTokens = await presale.claimableTokens(signers.charlie.address);
      const clearClaimableTokens = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        claimableTokens.toString(),
        presaleAddress,
        signers.charlie,
      );
      console.log("charlie claimable tokens: ", clearClaimableTokens);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      // increase time in hardhat
      await network.provider.send("evm_increaseTime", [7200]);

      // alice finalize presale
      await presale.connect(signers.alice).requestFinalizePresaleState();
    });

    it("Test finalize presale", async function () {
      // owner token balance before finalize
      const ownerTokenBalanceBefore = await token.balanceOf(await presale.owner());

      // Use the built-in `awaitDecryptionOracle` helper to wait for the FHEVM decryption oracle
      // to complete all pending Solidity decryption requests.
      await fhevm.awaitDecryptionOracle();

      // owner token balance after finalize
      const ownerTokenBalanceAfter = await token.balanceOf(await presale.owner());

      const tokensSold = (aliceActualPurchased + charlieActualPurchased) * tokenPerEth * 10n ** 9n;

      // get presale state
      const pool = await presale.pool();
      expect(pool.state).to.eq(4);
      expect(pool.weiRaised).to.eq((aliceActualPurchased + charlieActualPurchased) * 10n ** 9n);
      expect(pool.tokensSold).to.eq(tokensSold);

      // owner token refunded
      expect(ownerTokenBalanceAfter - ownerTokenBalanceBefore).to.eq(pool.options.tokenPresale - tokensSold);
    });

    it("Test alice claim tokens", async function () {
      // alice clamble token
      const aliceClaimableTokens = aliceActualPurchased * tokenPerEth;

      // alice claim tokens
      await presale.connect(signers.alice).claimTokens(signers.alice.address);

      // check alice's token balance
      const aliceTokenBalance = await ctoken.balanceOf(signers.alice.address);
      const clearAliceTokenBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceTokenBalance.toString(),
        await ctoken.getAddress(),
        signers.alice,
      );
      expect(clearAliceTokenBalance).to.eq(aliceClaimableTokens);
    });

    it("test claim charlie token", async function () {
      // charlie claim tokens
      await presale.connect(signers.charlie).claimTokens(signers.charlie.address);

      // check charlie's token balance
      const charlieTokenBalance = await ctoken.balanceOf(signers.charlie.address);
      const clearCharlieTokenBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        charlieTokenBalance.toString(),
        await ctoken.getAddress(),
        signers.charlie,
      );
      expect(clearCharlieTokenBalance).to.eq(charlieActualPurchased * tokenPerEth);
    });
  });
});

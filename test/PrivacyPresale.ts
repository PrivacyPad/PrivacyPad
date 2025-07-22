import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";
import { expect } from "chai";
import { Log } from "ethers";
import { ConfidentialWETH, PrivacyPresaleFactory, PrivacyPresale } from "../types/contracts";
import {
  ConfidentialWETH__factory,
  PrivacyPresaleFactory__factory,
  PrivacyPresale__factory,
} from "../types/factories/contracts";
import { FhevmType } from "@fhevm/hardhat-plugin";

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

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], charlie: ethSigners[3] };

    console.log("deployer: ", signers.deployer.address);
    console.log("alice: ", signers.alice.address);
    console.log("bob: ", signers.bob.address);
    console.log("charlie: ", signers.charlie.address);

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
    const finalizeLib = await (await ethers.deployContract("PrivacyPresaleFinalizeLib")).waitForDeployment();
    const purchaseLib = await (await ethers.deployContract("PrivacyPresalePurchaseLib")).waitForDeployment();

    // Get their addresses
    const finalizeLibAddress = await finalizeLib.getAddress();
    const purchaseLibAddress = await purchaseLib.getAddress();

    // 2. Deploy PrivacyPresaleFactory
    factory = (await (
      await new PrivacyPresaleFactory__factory(
        {
          "contracts/PrivacyPresaleFinalizeLib.sol:PrivacyPresaleFinalizeLib": finalizeLibAddress,
          "contracts/PrivacyPresalePurchaseLib.sol:PrivacyPresalePurchaseLib": purchaseLibAddress,
        },
        signers.deployer,
      ).deploy(await cweth.getAddress(), DUMMY_UNISWAP_ROUTER)
    ).waitForDeployment()) as PrivacyPresaleFactory;

    hardCap = ethers.parseUnits("10", 9); // 10 ETH
    softCap = ethers.parseUnits("6", 9); // 6 ETH
    tokenPresale = ethers.parseUnits("1000000000", 18); // 1_000_000_000
    tokenAddLiquidity = ethers.parseUnits("1000000000", 18); // 1_000_000_000
    // 3. Create a new PrivacyPresale with a new token
    const now = Math.floor(Date.now() / 1000);
    const presaleOptions = {
      tokenAddLiquidity, // in token decimal
      tokenPresale, // in token decimal
      hardCap, // 10 ETH
      softCap, // 6 ETH
      start: BigInt(now - 60), // started 1 min ago
      end: BigInt(now + 3600), // ends in 1 hour
    };

    tokenPerEth = tokenPresale / BigInt(10 ** 9) / hardCap;

    console.log("tokenPerEth: ", tokenPerEth);

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
    presale = PrivacyPresale__factory.connect(presaleAddress, signers.alice) as PrivacyPresale;

    console.log("presale address: ", presaleAddress);
    console.log("cweth address: ", await cweth.getAddress());
  });

  it("Test wrap", async function () {
    // 4. Alice wraps 1 ETH to cweth
    const wrapAmount = ethers.parseUnits("1", 18); // 1 ETH
    const clearWrapAmount = ethers.parseUnits("1", 9); // 1 ETH
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
    await cweth.connect(signers.alice).setOperator(presaleAddress, BigInt(Math.floor(Date.now() / 1000) + 1000));

    // 5. Alice purchases in the presale using cweth
    // Encrypt 1 (in 9 decimals, as required by the contract)
    const purchaseAmount = ethers.parseUnits("1", 9); // 1 ETH
    purchased += purchaseAmount;
    const encrypted = await fhevm
      .createEncryptedInput(presaleAddress, signers.alice.address)
      .add64(purchaseAmount)
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
    expect(clearAliceCwethContribution).to.eq(purchaseAmount);

    const claimableTokens = await presale.claimableTokens(signers.alice.address);
    const clearClaimableTokens = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      claimableTokens.toString(),
      presaleAddress,
      signers.alice,
    );
    console.log("alice claimable tokens: ", clearClaimableTokens);
    expect(clearClaimableTokens).to.eq(purchaseAmount * tokenPerEth);
  });

  it("Test purchase bob, bob purchase more then hard cap", async function () {
    // bob wrap
    const wrapAmount = ethers.parseUnits("100", 18); // 100 ETH
    await cweth.connect(signers.bob).deposit(signers.bob.address, { value: wrapAmount });

    // alice approve cweth
    await cweth.connect(signers.bob).setOperator(presaleAddress, BigInt(Math.floor(Date.now() / 1000) + 1000));

    // 5. Alice purchases in the presale using cweth
    // Encrypt 1 (in 9 decimals, as required by the contract)
    const purchaseAmount = ethers.parseUnits("10", 9); // 10 ETH
    const beforePurchased = purchased;
    purchased += purchaseAmount;

    let contributionShouldBe = 0n;

    if (purchased > hardCap) {
      contributionShouldBe = hardCap - beforePurchased;
      purchased = hardCap;
    } else {
      contributionShouldBe = purchaseAmount;
    }

    const encrypted = await fhevm
      .createEncryptedInput(presaleAddress, signers.bob.address)
      .add64(purchaseAmount)
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
    await cweth.connect(signers.charlie).setOperator(presaleAddress, BigInt(Math.floor(Date.now() / 1000) + 1000));

    // 5. Charlie purchases in the presale using cweth
    // Encrypt 1 (in 9 decimals, as required by the contract)
    const purchaseAmount = ethers.parseUnits("2", 9); // 2 ETH
    const beforePurchased = purchased;
    purchased += purchaseAmount;

    let contributionShouldBe = 0n;

    if (purchased > hardCap) {
      contributionShouldBe = hardCap - beforePurchased;
    } else {
      contributionShouldBe = purchaseAmount;
    }

    const encrypted = await fhevm
      .createEncryptedInput(presaleAddress, signers.charlie.address)
      .add64(purchaseAmount)
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

    console.log("decryption oracle done");

    // get presale state
    const pool = await presale.pool();
    expect(pool.state).to.eq(4);
    expect(pool.weiRaised).to.eq(hardCap * 10n ** 9n);
    expect(pool.tokensSold).to.eq(BigInt(tokenPresale));
  });
});

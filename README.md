# PrivacyPad - Privacy-Preserving Launchpad Protocol

<p align="center">
    <a target="blank"><img src="./logo.jpg" alt="Zama Logo" width="200" /></a>
</p>

<p align="center">
A decentralized launchpad protocol focused on financial privacy, powered by Fully Homomorphic Encryption (FHE).
</p>

## App - Demo link

<a href="https://launchpad-interface-eight.vercel.app/ ">MVP app link</a>

<a href="https://drive.google.com/drive/folders/1qVWWKMerpkDfAW2cw7hoYnB8EopLcnS1">Video demo</a>

## Description

**PrivacyPad** is a decentralized launchpad protocol focused on financial privacy. It leverages Fully Homomorphic
Encryption (FHE) powered by the Zama protocol to enable private participation in token launches—users can invest without
revealing their token purchase amounts.

## Features

1. **Private Token Purchases**: All user contributions are encrypted. Only the final aggregated result is decrypted
   after the sale ends.

2. **Confidential Token Wrapping**: Wrap standard ERC-20 tokens into confidential equivalents using OpenZeppelin's
   ConfidentialFungibleTokenERC20Wrapper.

3. **Confidential WETH (cWETH)**: Wrap ETH into cWETH to invest privately in presales.

4. **Decryption On Demand**: Final contribution aggregated result is only revealed at the end for distribution and
   liquidity operations.

## How It Works

### 1. Token Seller Setup

The seller creates a token or deposits their standard ERC-20 token into the PrivacyPad contract.

### 2. User Contributions

Users invest with cWETH (Confidential WETH), allowing fully private investment. Their contribution amounts are encrypted
and hidden on-chain.

### 3. Decryption After Deadline

Once the presale ends, the protocol triggers a controlled decryption process to reveal contribution amounts for
settlement.

### 4. Sale Settlement

**If the presale is successful:**

- ERC-20 tokens are wrapped into their confidential form (cTokens)
- cWETH is unwrapped into ETH and used to add liquidity with normal token on DEXes (Currently support UniswapV3)
- Users can privately claim their cTokens

**If the presale fails:**

- Users reclaim their cWETH
- Unsold tokens are returned to the token seller

## Contract Architecture

```
contracts/
├── Core Contracts
│   ├── PrivacyPresale.sol              # Main presale contract with FHE privacy
│   └── PrivacyPresaleFactory.sol       # Factory for creating presale instances
│
│
├── Confidential Tokens
│   ├── ConfidentialWETH.sol            # Confidential WETH wrapper
│   ├── ConfidentialTokenWrapper.sol    # Base confidential token wrapper
│   └── PresaleToken.sol                # Normal token for presale testing
│
├── Interfaces/
│   ├── IPrivacyPresale.sol             # Interface for privacy presale
│
└── Libraries/
    ├── TransferHelper.sol              # Safe token transfer utilities
    └── PrivacyPresaleLib.sol           # Library for presale logic
```

## Tech Stack

- **Zama FHE VM**: Privacy-preserving computation layer
- **OpenZeppelin Confidential Token Wrappers**: ERC-20 confidentiality layer
- **Hardhat**: Development and testing framework
- **Solidity**: Smart contract development

## Future Development

- **Expand Token Support**: Integrate additional investment tokens such as cUSDT, cDAI, and others to enhance platform
  versatility.
- **Support more types of investment**:
  - Fair Launch
  - Overflow Mechanism
  - Private Sale
  - Bonding Curve
- **Integrate Privacy-Enabled DEXs**: As decentralized exchanges evolve to support cTokens, we aim to leverage these
  platforms to enable fully private investment and trading experiences

## Supported Chains

### Sepolia Testnet

- ConfidentialWETH: `0x1A7258dFA114fc3Daf2849F131aF022E3Ec90eEe`
- PrivacyPresaleFactory: `0x1B28564C202cB44d8bA06d7EE6F45E7842a2c711`

## How to deploy

```bash
# Deploy PrivacyPresaleFactory to Sepolia
npx hardhat deploy --network sepolia --tags PrivacyPresaleFactory
```

## How to test

```bash
npx hardhat test
```

## Documentation

- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [FHEVM Hardhat Quick Start Tutorial](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial)
- [How to set up a FHEVM Hardhat development environment](https://docs.zama.ai/protocol/solidity-guides/getting-started/setup)
- [Run the FHEVM Hardhat Template Tests](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/run_test)
- [Write FHEVM Tests using Hardhat](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/write_test)
- [FHEVM Hardhat Plugin](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat)

## License

[Apache-2.0](LICENSE)

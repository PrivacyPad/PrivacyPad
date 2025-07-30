# PrivacyPresale Tasks Documentation

This document provides comprehensive instructions for using the PrivacyPresale and PrivacyPresaleFactory interaction
tasks.

## Overview

The PrivacyPresale system allows for confidential token sales with the following features:

- **Privacy**: All purchase amounts and token allocations are encrypted using FHE (Fully Homomorphic Encryption)
- **Flexible**: Configurable hard cap, soft cap, duration, and liquidity parameters
- **Secure**: Built-in refund mechanisms for failed presales
- **Transparent**: Clear state management and event tracking

## Prerequisites

1. **Hardhat Environment**: Make sure you have Hardhat installed and configured
2. **FHEVM**: The tasks require FHEVM for encrypted operations
3. **Network**: Tasks work on both localhost (for testing) and Sepolia (for production)

## Quick Start Guide

### 1. Deploy the Factory

First, deploy the PrivacyPresaleFactory which will manage all presales:

```bash
npx hardhat --network localhost task:deploy-factory
```

This will deploy:

- ConfidentialWETH (cWETH) for encrypted ETH operations
- PrivacyPresaleLib library
- PrivacyPresaleFactory

### 2. Create a Presale

Create a new privacy presale with your desired parameters:

```bash
npx hardhat --network localhost task:create-presale \
  --name "MyToken" \
  --symbol "MTK" \
  --hardcap 10 \
  --softcap 6 \
  --duration 24 \
  --liquidity 50
```

Parameters:

- `--name`: Token name
- `--symbol`: Token symbol
- `--hardcap`: Maximum ETH to raise
- `--softcap`: Minimum ETH required for success
- `--duration`: Presale duration in hours (optional, default: 1)
- `--liquidity`: Percentage of raised ETH for liquidity (optional, default: 50)

### 3. Wrap ETH to cWETH

Users need to wrap their ETH to confidential WETH before participating:

```bash
npx hardhat --network localhost task:wrap-eth --amount 5 --user 1
```

Parameters:

- `--amount`: Amount of ETH to wrap
- `--user`: User index (0, 1, 2, etc.)
- `--cweth`: cWETH contract address (optional, auto-detected if not provided)

### 4. Purchase Tokens

Users can purchase tokens in the presale:

```bash
npx hardhat --network localhost task:purchase \
  --amount 2 \
  --user 1 \
  --presale-address 0x... \
  --beneficiary 0x...  # optional, defaults to user address
```

Parameters:

- `--amount`: Amount of ETH to invest
- `--user`: User index
- `--presale-address`: Address of the presale contract
- `--beneficiary`: Beneficiary address (optional)

### 5. Finalize the Presale

After the presale period ends, request finalization:

```bash
npx hardhat --network localhost task:request-finalize \
  --presale-address 0x... \
  --user 1
```

### 6. Claim Tokens (Successful Presale)

If the presale reaches the soft cap, users can claim their tokens:

```bash
npx hardhat --network localhost task:claim-tokens \
  --presale-address 0x... \
  --user 1
```

### 7. Refund (Failed Presale)

If the presale doesn't reach the soft cap, users can get refunds:

```bash
npx hardhat --network localhost task:refund \
  --presale-address 0x... \
  --user 1
```

## Complete Example Workflow

Here's a complete example of running a successful presale:

```bash
# 1. Deploy factory
npx hardhat --network localhost task:deploy-factory

# 2. Create presale (save the presale address from output)
npx hardhat --network localhost task:create-presale \
  --name "TestToken" \
  --symbol "TTK" \
  --hardcap 10 \
  --softcap 6

# 3. Wrap ETH for multiple users
npx hardhat --network localhost task:wrap-eth --amount 5 --user 1
npx hardhat --network localhost task:wrap-eth --amount 10 --user 2
npx hardhat --network localhost task:wrap-eth --amount 3 --user 3

# 4. Purchase tokens (replace PRESALE_ADDRESS with actual address)
npx hardhat --network localhost task:purchase --amount 2 --user 1 --presale-address PRESALE_ADDRESS
npx hardhat --network localhost task:purchase --amount 5 --user 2 --presale-address PRESALE_ADDRESS
npx hardhat --network localhost task:purchase --amount 3 --user 3 --presale-address PRESALE_ADDRESS

# 5. Finalize presale
npx hardhat --network localhost task:request-finalize --presale-address PRESALE_ADDRESS --user 1

# 6. Claim tokens
npx hardhat --network localhost task:claim-tokens --presale-address PRESALE_ADDRESS --user 1
npx hardhat --network localhost task:claim-tokens --presale-address PRESALE_ADDRESS --user 2
npx hardhat --network localhost task:claim-tokens --presale-address PRESALE_ADDRESS --user 3
```

## Information Tasks

### Get Presale Information

View detailed information about a presale:

```bash
npx hardhat --network localhost task:presale-info --presale-address 0x...
```

This shows:

- Presale state (Active, Waiting, Cancelled, Finalized)
- Token addresses
- Wei raised and tokens sold
- Presale configuration options
- Timestamps

### Get User Information

Check a user's contribution and claim status:

```bash
npx hardhat --network localhost task:user-info --presale-address 0x... --user 1
```

This shows:

- User's contribution amount
- Claimable tokens
- Whether tokens have been claimed
- Whether refund has been processed

## Presale States

The presale goes through different states:

1. **Active (1)**: Presale is open for purchases
2. **Waiting for finalize (2)**: Presale period ended, waiting for finalization
3. **Cancelled (3)**: Presale failed (didn't reach soft cap)
4. **Finalized (4)**: Presale succeeded (reached soft cap)

## Network Support

### Localhost (Testing)

```bash
npx hardhat --network localhost task:deploy-factory
```

### Sepolia (Production)

```bash
npx hardhat --network sepolia task:deploy-factory
```

## Error Handling

The tasks include comprehensive error handling:

- **Insufficient Balance**: Checks if user has enough cWETH before purchase
- **Invalid State**: Ensures presale is in correct state for operations
- **Already Claimed/Refunded**: Prevents double claims or refunds
- **Invalid Parameters**: Validates input parameters

## Security Features

1. **Encrypted Operations**: All purchase amounts are encrypted using FHE
2. **Operator Approvals**: cWETH spending requires explicit approval
3. **State Validation**: Operations only work in appropriate presale states
4. **Beneficiary Support**: Users can specify different beneficiary addresses

## Troubleshooting

### Common Issues

1. **"Factory address not found"**: Deploy the factory first using `task:deploy-factory`
2. **"Insufficient cWETH balance"**: Wrap more ETH using `task:wrap-eth`
3. **"Presale is not finalized"**: Wait for finalization or check presale state
4. **"Already claimed"**: Tokens can only be claimed once per user

### Debugging

Use the information tasks to debug issues:

```bash
# Check presale state
npx hardhat --network localhost task:presale-info --presale-address 0x...

# Check user status
npx hardhat --network localhost task:user-info --presale-address 0x... --user 1
```

## Advanced Usage

### Custom Parameters

You can customize presale parameters:

```bash
# Create presale with custom duration and liquidity
npx hardhat --network localhost task:create-presale \
  --name "CustomToken" \
  --symbol "CTK" \
  --hardcap 20 \
  --softcap 10 \
  --duration 48 \
  --liquidity 75
```

### Multiple Users

Test with multiple users by using different user indices:

```bash
# User 0 (deployer)
npx hardhat --network localhost task:wrap-eth --amount 10 --user 0

# User 1
npx hardhat --network localhost task:wrap-eth --amount 5 --user 1

# User 2
npx hardhat --network localhost task:wrap-eth --amount 8 --user 2
```

## Contract Addresses

After deployment, save these important addresses:

- **Factory Address**: Used to create new presales
- **cWETH Address**: Used for ETH wrapping operations
- **Presale Address**: Used for all presale interactions
- **Token Address**: The underlying ERC20 token
- **Confidential Token Address**: The encrypted token wrapper

## Best Practices

1. **Test Locally First**: Always test on localhost before deploying to Sepolia
2. **Save Addresses**: Keep track of deployed contract addresses
3. **Monitor States**: Use information tasks to monitor presale progress
4. **Handle Errors**: Check error messages and use appropriate tasks
5. **Security**: Never share private keys or sensitive information

## Support

For issues or questions:

1. Check the error messages for specific guidance
2. Use the information tasks to debug state issues
3. Verify all parameters are correct
4. Ensure proper network configuration

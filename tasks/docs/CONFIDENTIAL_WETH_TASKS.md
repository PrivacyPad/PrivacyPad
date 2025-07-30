# ConfidentialWETH Tasks Documentation

This document provides comprehensive instructions for using the ConfidentialWETH interaction tasks.

## File Structure

The ConfidentialWETH tasks are located in a separate file:

- **`tasks/ConfidentialWETH.ts`** - Contains all ConfidentialWETH-related tasks
- **`hardhat.config.ts`** - Imports the ConfidentialWETH tasks

This separation provides better organization and modularity compared to having all tasks in a single file.

## Overview

ConfidentialWETH (cWETH) is a privacy-preserved version of Wrapped ETH that uses Fully Homomorphic Encryption (FHE) to
keep balances and transactions confidential. The tasks provide a complete CLI interface for managing cWETH operations.

## Key Features

- **Privacy**: All balances and amounts are encrypted using FHE
- **Rate-based Conversion**: 1 cWETH = 1 ETH (rate of 10^9)
- **Asynchronous Withdrawals**: Withdrawals require off-chain decryption
- **Secure Operations**: All operations maintain privacy and security

## Available Tasks

### 1. Deposit ETH to ConfidentialWETH

**Task**: `task:cweth-deposit`

**Description**: Deposit ETH to receive confidential WETH tokens.

**Usage**:

```bash
npx hardhat --network localhost task:cweth-deposit \
  --amount 5 \
  --user 1 \
  --cweth-address 0x... \
  --to 0x...  # optional, defaults to user address
```

**Parameters**:

- `--amount`: Amount of ETH to deposit
- `--user`: User index (0, 1, 2, etc.)
- `--cweth`: ConfidentialWETH contract address
- `--to`: Recipient address (optional, defaults to user)

**Example**:

```bash
# Deposit 5 ETH for user 1
npx hardhat --network localhost task:cweth-deposit \
  --amount 5 \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890

# Deposit 3 ETH to a specific address
npx hardhat --network localhost task:cweth-deposit \
  --amount 3 \
  --user 2 \
  --cweth-address 0x1234567890123456789012345678901234567890 \
  --to 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
```

### 2. Withdraw ETH from ConfidentialWETH

**Task**: `task:cweth-withdraw`

**Description**: Withdraw ETH by burning confidential WETH tokens.

**Usage**:

```bash
npx hardhat --network localhost task:cweth-withdraw \
  --amount 2 \
  --user 1 \
  --cweth-address 0x... \
  --to 0x...
```

**Parameters**:

- `--amount`: Amount of cWETH to withdraw
- `--user`: User index (0, 1, 2, etc.)
- `--cweth`: ConfidentialWETH contract address
- `--to`: Recipient address for ETH

**Example**:

```bash
# Withdraw 2 cWETH to user's address
npx hardhat --network localhost task:cweth-withdraw \
  --amount 2 \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890 \
  --to 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
```

**Important Notes**:

- Withdrawals are asynchronous and require off-chain decryption
- The ETH will be sent to the recipient address after decryption
- Make sure the user has sufficient cWETH balance

### 3. Get ConfidentialWETH Balance

**Task**: `task:cweth-balance`

**Description**: Get the confidential WETH balance for a specific user.

**Usage**:

```bash
npx hardhat --network localhost task:cweth-balance \
  --user 1 \
  --cweth-address 0x...
```

**Parameters**:

- `--user`: User index (0, 1, 2, etc.)
- `--cweth`: ConfidentialWETH contract address

**Example**:

```bash
# Get balance for user 1
npx hardhat --network localhost task:cweth-balance \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890
```

**Output**:

```
👤 ConfidentialWETH Balance:
User address: 0x...
Balance: 5000000000
Decimals: 9
Rate: 1000000000
```

### 4. Get ConfidentialWETH Contract Information

**Task**: `task:cweth-info`

**Description**: Get detailed information about the ConfidentialWETH contract.

**Usage**:

```bash
npx hardhat --network localhost task:cweth-info \
  --cweth-address 0x...
```

**Parameters**:

- `--cweth`: ConfidentialWETH contract address

**Example**:

```bash
# Get contract information
npx hardhat --network localhost task:cweth-info \
  --cweth-address 0x1234567890123456789012345678901234567890
```

**Output**:

```
📊 ConfidentialWETH Contract Information:
Address: 0x1234567890123456789012345678901234567890
Name: Confidential WETH
Symbol: cWETH
Decimals: 9
Rate: 1000000000
Rate explanation: 1 cWETH = 1 ETH
```

## Complete Workflow Example

Here's a complete example of using ConfidentialWETH:

```bash
# 1. Deploy factory (if not already deployed)
npx hardhat --network localhost task:deploy-factory

# 2. Get cWETH address from factory deployment output
# Let's assume it's: 0x1234567890123456789012345678901234567890

# 3. Get contract information
npx hardhat --network localhost task:cweth-info \
  --cweth-address 0x1234567890123456789012345678901234567890

# 4. Deposit ETH for multiple users
npx hardhat --network localhost task:cweth-deposit \
  --amount 10 \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890

npx hardhat --network localhost task:cweth-deposit \
  --amount 5 \
  --user 2 \
  --cweth-address 0x1234567890123456789012345678901234567890

# 5. Check balances
npx hardhat --network localhost task:cweth-balance \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890

npx hardhat --network localhost task:cweth-balance \
  --user 2 \
  --cweth-address 0x1234567890123456789012345678901234567890

# 6. Withdraw ETH (asynchronous)
npx hardhat --network localhost task:cweth-withdraw \
  --amount 3 \
  --user 1 \
  --cweth-address 0x1234567890123456789012345678901234567890 \
  --to 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
```

## Technical Details

### Rate and Decimals

- **Rate**: 1,000,000,000 (10^9)
- **Decimals**: 9
- **Conversion**: 1 cWETH = 1 ETH
- **Deposit**: Amount is rounded down to nearest multiple of rate
- **Withdrawal**: Amount \* rate = ETH received

### Privacy Features

1. **Encrypted Balances**: All balances are encrypted using FHE
2. **Encrypted Operations**: All amounts in operations are encrypted
3. **Confidential Transfers**: Transfers maintain privacy
4. **Secure Approvals**: Operator approvals are required for withdrawals

### Asynchronous Withdrawals

Withdrawals in ConfidentialWETH are asynchronous:

1. **Request**: User calls withdraw with encrypted amount
2. **Decryption**: Off-chain decryption process
3. **Finalization**: ETH is sent to recipient after decryption
4. **Signatures**: Cryptographic signatures ensure security

## Error Handling

The tasks include comprehensive error handling:

- **Insufficient Balance**: Checks if user has enough cWETH before withdrawal
- **Invalid Addresses**: Validates contract and user addresses
- **Network Issues**: Handles network connectivity problems
- **FHE Errors**: Manages FHE-related errors gracefully

## Security Considerations

1. **Private Keys**: Never share private keys or sensitive information
2. **Address Validation**: Always verify contract addresses
3. **Balance Checks**: Verify balances before operations
4. **Network Security**: Use secure networks for production

## Troubleshooting

### Common Issues

1. **"Insufficient cWETH balance"**: Deposit more ETH first
2. **"Contract not found"**: Verify the cWETH address
3. **"FHE initialization failed"**: Check network connectivity
4. **"Withdrawal pending"**: Withdrawals are asynchronous

### Debugging

Use the balance and info tasks to debug issues:

```bash
# Check contract status
npx hardhat --network localhost task:cweth-info --cweth-address 0x...

# Check user balance
npx hardhat --network localhost task:cweth-balance --user 1 --cweth-address 0x...
```

## Integration with PrivacyPresale

ConfidentialWETH is used in the PrivacyPresale system:

1. **Deposit ETH**: Users deposit ETH to get cWETH
2. **Purchase Tokens**: Users use cWETH to purchase presale tokens
3. **Refunds**: Failed presales refund cWETH to users
4. **Withdraw**: Users can withdraw ETH from cWETH

## Best Practices

1. **Test Locally**: Always test on localhost first
2. **Save Addresses**: Keep track of deployed contract addresses
3. **Monitor Balances**: Check balances before operations
4. **Secure Operations**: Use secure networks for production
5. **Backup Data**: Keep backup of important addresses and balances

## Network Support

### Localhost (Testing)

```bash
npx hardhat --network localhost task:cweth-deposit --amount 5 --user 1 --cweth-address 0x...
```

### Sepolia (Production)

```bash
npx hardhat --network sepolia task:cweth-deposit --amount 5 --user 1 --cweth-address 0x...
```

## Support

For issues or questions:

1. Check error messages for specific guidance
2. Use the info and balance tasks to debug
3. Verify all parameters are correct
4. Ensure proper network configuration
5. Check FHE network connectivity

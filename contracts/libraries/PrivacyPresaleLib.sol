// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ConfidentialTokenWrapper} from "../ConfidentialTokenWrapper.sol";
import {PrivacyPresale} from "../PrivacyPresale.sol";
import {ConfidentialWETH} from "../ConfidentialWETH.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {TransferHelper} from "./TransferHelper.sol";

library PrivacyPresaleLib {
    using SafeERC20 for IERC20;
    IWETH9 public constant WETH = IWETH9(0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14);
    INonfungiblePositionManager public constant POSM =
        INonfungiblePositionManager(0x1238536071E1c677A632429e3655c799b22cDA52);
    int24 private constant TICK_MIN_USABLE = -887220;
    int24 private constant TICK_MAX_USABLE = 887220;
    uint24 private constant LP_FEE = 3000;

    /**
     * @notice Handles purchase logic with aggressive storage read optimization
     * @dev Caches all storage variables to minimize SLOAD operations
     */
    function handlePurchase(
        PrivacyPresale.Pool storage pool,
        mapping(address => euint64) storage contributions,
        mapping(address => euint64) storage claimableTokens,
        address beneficiary,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        // Cache ALL frequently accessed storage variables to minimize SLOAD operations
        address cweth = pool.cweth;
        uint64 tokenPerEthWithDecimals = pool.tokenPerEthWithDecimals;
        uint64 hardCap = pool.options.hardCap;

        // Cache user's existing contributions and claimable tokens to avoid multiple storage reads
        euint64 userContribution = contributions[beneficiary];
        euint64 userClaimableTokens = claimableTokens[beneficiary];

        // Convert external encrypted amount to internal format
        euint64 transferAmount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(transferAmount, cweth);

        // Perform confidential transfer
        euint64 transferred = ConfidentialTokenWrapper(cweth).confidentialTransferFrom(
            beneficiary,
            address(this),
            transferAmount
        );

        // Cache current eth raised to avoid multiple storage reads
        euint64 currentEthRaised = pool.ethRaisedEncrypted;
        euint64 newEthRaised = FHE.add(currentEthRaised, transferred);

        // Check if hard cap exceeded and calculate refund using cached values
        ebool isAbove = FHE.gt(newEthRaised, hardCap);
        euint64 refundAmount = FHE.select(isAbove, FHE.sub(newEthRaised, hardCap), FHE.asEuint64(0));

        // Calculate final eth raised and contribution amount
        euint64 finalEthRaised = FHE.sub(newEthRaised, refundAmount);
        euint64 contributeAmount = FHE.sub(transferred, refundAmount);

        // Update storage variables in batch to minimize SSTORE operations
        pool.ethRaisedEncrypted = finalEthRaised;
        FHE.allowThis(pool.ethRaisedEncrypted);

        // Process refund if needed
        FHE.allowTransient(refundAmount, cweth);
        ConfidentialTokenWrapper(cweth).confidentialTransfer(beneficiary, refundAmount);

        // Calculate new user contributions and claimable tokens using cached values
        euint64 newUserContribution = FHE.add(userContribution, contributeAmount);
        euint64 tokensSoldEncrypted = FHE.mul(contributeAmount, tokenPerEthWithDecimals);
        euint64 newUserClaimableTokens = FHE.add(userClaimableTokens, tokensSoldEncrypted);

        // Cache current tokens sold to avoid storage read
        euint64 currentTokensSold = pool.tokensSoldEncrypted;
        euint64 newTokensSold = FHE.add(currentTokensSold, tokensSoldEncrypted);

        // Update all storage variables in batch
        contributions[beneficiary] = newUserContribution;
        claimableTokens[beneficiary] = newUserClaimableTokens;
        pool.tokensSoldEncrypted = newTokensSold;

        // Batch FHE allow operations to minimize gas cost
        FHE.allowThis(newUserContribution);
        FHE.allow(newUserContribution, beneficiary);
        FHE.allowThis(newTokensSold);
        FHE.allowThis(newUserClaimableTokens);
        FHE.allow(newUserClaimableTokens, beneficiary);
    }

    /**
     * @notice Requests finalization of presale state with minimal storage reads
     * @dev Caches pool state and options to reduce storage access
     */
    function handleRequestFinalizePresaleState(PrivacyPresale.Pool storage pool) external {
        // Cache pool state and end time to avoid multiple storage reads
        uint8 currentState = pool.state;
        uint128 endTime = pool.options.end;

        require(currentState == 1 || currentState == 2, "Presale is not active");
        require(block.timestamp >= endTime, "Presale is not ended");

        pool.state = 2;

        // Cache encrypted values to avoid multiple storage reads
        euint64 ethRaisedEncrypted = pool.ethRaisedEncrypted;
        euint64 tokensSoldEncrypted = pool.tokensSoldEncrypted;

        // Optimize array creation by using fixed size array
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = euint64.unwrap(ethRaisedEncrypted);
        cts[1] = euint64.unwrap(tokensSoldEncrypted);

        FHE.requestDecryption(cts, PrivacyPresale.finalizePreSale.selector);
    }

    /**
     * @notice Finalizes presale with aggressive storage read optimization
     * @dev Caches all storage variables and combines operations to minimize gas cost
     */
    function handleFinalizePreSale(
        PrivacyPresale.Pool storage pool,
        address poolOwner,
        ConfidentialWETH ceth,
        ConfidentialTokenWrapper ctoken,
        IERC20 token,
        uint64 cwethRaised,
        uint64 tokensSold
    ) external {
        // Cache ALL frequently accessed storage values to minimize SLOAD operations
        uint256 rate = ctoken.rate();
        uint256 tokenPresale = pool.options.tokenPresale;
        uint256 tokenAddLiquidity = pool.options.tokenAddLiquidity;
        uint64 softCap = pool.options.softCap;
        euint64 ethRaisedEncrypted = pool.ethRaisedEncrypted;

        // Calculate all values once and reuse to avoid redundant calculations
        uint256 weiRaised = cwethRaised * 1e9; // Use constant instead of 10**9
        uint256 tokensSoldValue = tokensSold * rate;

        // Update storage variables in batch
        pool.weiRaised = weiRaised;
        pool.tokensSold = tokensSoldValue;

        require(pool.state == 2, "Invalid pool state");

        if (cwethRaised < softCap) {
            // Presale failed - return tokens to owner
            pool.state = 3;
            token.safeTransfer(poolOwner, tokenPresale);
        } else {
            // Presale successful - process finalization
            pool.state = 4;

            // Calculate unsold tokens and leftover liquidity tokens using cached values
            if (tokenPresale > tokensSoldValue) {
                uint256 unsoldToken = tokenPresale - tokensSoldValue;
                uint256 leftOverLiquidityToken = tokenAddLiquidity -
                    (tokenAddLiquidity * tokensSoldValue) /
                    tokenPresale;

                // Combine transfers to reduce gas cost
                token.safeTransfer(poolOwner, unsoldToken + leftOverLiquidityToken);
            }

            // Wrap sold tokens to confidential tokens
            token.approve(address(ctoken), tokensSoldValue);
            ctoken.wrap(address(this), tokensSoldValue);

            // send earned eth to poolOwner will be executed when add liquidity
            // = pool.ethRaisedEncrypted * pool.options.liquidityPercentage / MAX_LIQUIDITY_PERCENTAGE

            // Unwrap confidential ETH for liquidity using cached value
            FHE.allowTransient(ethRaisedEncrypted, address(ceth));
            ceth.withdraw(address(this), address(this), ethRaisedEncrypted);
        }
    }

    function addLiquidity(
        address token,
        uint256 balanceTokenAddLiquidity,
        uint256 balanceETHAddLiquidity
    ) external returns (address) {
        WETH.deposit{value: balanceETHAddLiquidity}();
        (address token0, address token1, uint256 balance0, uint256 balance1) = (uint160(token) < uint160(address(WETH)))
            ? (token, address(WETH), balanceTokenAddLiquidity, balanceETHAddLiquidity)
            : (address(WETH), token, balanceETHAddLiquidity, balanceTokenAddLiquidity);
        uint160 initializePrice = uint160(sqrt((balance1 << 96) / balance0) << 48);
        address _pool = POSM.createAndInitializePoolIfNecessary(token0, token1, LP_FEE, initializePrice);
        TransferHelper.safeApprove(token0, address(POSM), balance0);
        TransferHelper.safeApprove(token1, address(POSM), balance1);

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: LP_FEE,
            tickLower: TICK_MIN_USABLE,
            tickUpper: TICK_MAX_USABLE,
            amount0Desired: balance0,
            amount1Desired: balance1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });

        POSM.mint(params);
        return _pool;
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ConfidentialTokenWrapper} from "./ConfidentialTokenWrapper.sol";
import {PrivacyPresale} from "./PrivacyPresale.sol";
import {ConfidentialWETH} from "./ConfidentialWETH.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

library PrivacyPresaleLib {
    using SafeERC20 for IERC20;

    function handlePurchase(
        PrivacyPresale.Pool storage pool,
        mapping(address => euint64) storage contributions,
        mapping(address => euint64) storage claimableTokens,
        address beneficiary,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        euint64 transferAmount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(transferAmount, pool.cweth);
        euint64 transferred = ConfidentialTokenWrapper(pool.cweth).confidentialTransferFrom(
            beneficiary,
            address(this),
            transferAmount
        );
        pool.ethRaisedEncrypted = FHE.add(pool.ethRaisedEncrypted, transferred);

        ebool isAbove = FHE.gt(pool.ethRaisedEncrypted, pool.options.hardCap);
        euint64 refundAmount = FHE.select(
            isAbove,
            FHE.sub(pool.ethRaisedEncrypted, pool.options.hardCap),
            FHE.asEuint64(0)
        );
        pool.ethRaisedEncrypted = FHE.sub(pool.ethRaisedEncrypted, refundAmount);
        FHE.allowThis(pool.ethRaisedEncrypted);

        euint64 contributeAmount = FHE.sub(transferred, refundAmount);
        FHE.allowTransient(refundAmount, pool.cweth);
        ConfidentialTokenWrapper(pool.cweth).confidentialTransfer(beneficiary, refundAmount);

        contributions[beneficiary] = FHE.add(contributions[beneficiary], contributeAmount);
        FHE.allowThis(contributions[beneficiary]);
        FHE.allow(contributions[beneficiary], beneficiary);

        euint64 tokensSoldEncrypted = FHE.mul(contributeAmount, pool.tokenPerEthWithDecimals);
        claimableTokens[beneficiary] = FHE.add(claimableTokens[beneficiary], tokensSoldEncrypted);
        pool.tokensSoldEncrypted = FHE.add(pool.tokensSoldEncrypted, tokensSoldEncrypted);
        FHE.allowThis(pool.tokensSoldEncrypted);
        FHE.allowThis(claimableTokens[beneficiary]);
        FHE.allow(claimableTokens[beneficiary], beneficiary);
    }

    function handleRequestFinalizePresaleState(PrivacyPresale.Pool storage pool) external {
        require(pool.state == 1, "Presale is not active");
        require(block.timestamp >= pool.options.end, "Presale is not ended");
        pool.state = 2;
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = euint64.unwrap(pool.ethRaisedEncrypted);
        cts[1] = euint64.unwrap(pool.tokensSoldEncrypted);
        uint256 requestID = FHE.requestDecryption(cts, PrivacyPresale.finalizePreSale.selector);
    }

    function handleFinalizePreSale(
        PrivacyPresale.Pool storage pool,
        address poolOwner,
        ConfidentialWETH ceth,
        ConfidentialTokenWrapper ctoken,
        IERC20 token,
        uint256 requestID,
        uint64 ethRaised,
        uint64 tokensSold,
        bytes[] memory signatures
    ) external {
        uint256 rate = ctoken.rate();
        pool.weiRaised = ethRaised * 10 ** 9;
        pool.tokensSold = tokensSold * rate;

        if (ethRaised < pool.options.softCap) {
            pool.state = 3;

            // transfer back all token to the pool owner
            token.safeTransfer(poolOwner, pool.options.tokenPresale);
        } else {
            pool.state = 4;

            // transfer unsold token to poolOwner
            if (pool.options.tokenPresale > pool.tokensSold) {
                token.safeTransfer(poolOwner, pool.options.tokenPresale - pool.tokensSold);
            }

            // wrap all sold token to ctoken
            token.approve(address(ctoken), pool.tokensSold);
            ctoken.wrap(address(this), pool.tokensSold);

            // unwrap all ceth in the contract to eth to add liquidity
            FHE.allowTransient(pool.ethRaisedEncrypted, address(ceth));
            ceth.withdraw(address(this), address(this), pool.ethRaisedEncrypted);
        }
    }
}

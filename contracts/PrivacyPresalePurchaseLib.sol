// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ConfidentialTokenWrapper} from "./ConfidentialTokenWrapper.sol";
import {PrivacyPresale} from "./PrivacyPresale.sol";

library PrivacyPresalePurchaseLib {
    function handlePurchase(
        PrivacyPresale.Pool storage pool,
        mapping(address => euint64) storage contributions,
        mapping(address => euint64) storage claimableTokens,
        address beneficiary,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        // Validate purchase
        require(pool.state == 1, "Invalid state");
        require(block.timestamp >= pool.options.start && block.timestamp <= pool.options.end, "Not in purchase period");

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
}

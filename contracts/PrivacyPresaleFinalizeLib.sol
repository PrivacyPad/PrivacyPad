// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {PrivacyPresale} from "./PrivacyPresale.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConfidentialTokenWrapper} from "./ConfidentialTokenWrapper.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfidentialWETH} from "./ConfidentialWETH.sol";

library PrivacyPresaleFinalizeLib {
    using SafeERC20 for IERC20;

    function handleRequestFinalizePresaleState(PrivacyPresale.Pool storage pool) external {
        require(pool.state == 1, "Presale is not active");
        require(block.timestamp >= pool.options.end, "Presale is not ended");
        pool.state = 2;
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = euint64.unwrap(pool.ethRaisedEncrypted);
        cts[1] = euint64.unwrap(pool.tokensSoldEncrypted);
        FHE.requestDecryption(cts, PrivacyPresale.finalizePreSale.selector);
    }

    function handleFinalizePreSale(
        PrivacyPresale.Pool storage pool,
        ConfidentialWETH ceth,
        ConfidentialTokenWrapper ctoken,
        IERC20 token,
        uint256 requestID,
        uint64 ethRaised,
        uint64 tokensSold,
        bytes[] calldata signatures
    ) external {
        FHE.checkSignatures(requestID, signatures);

        if (ethRaised < pool.options.softCap) {
            pool.state = 3;
        } else {
            pool.state = 4;
        }
        uint256 rate = ctoken.rate();
        pool.weiRaised = ethRaised * 10 ** 9;
        pool.tokensSold = tokensSold * rate;

        if (pool.options.tokenPresale > pool.tokensSold) {
            token.safeTransfer(msg.sender, pool.options.tokenPresale - pool.tokensSold);
        }

        // wrap all token to ctoken
        token.approve(address(ctoken), pool.tokensSold);
        ctoken.wrap(address(this), pool.tokensSold);

        // set operator to this contract
        ceth.setOperator(address(this), 60); // 1 minute

        // unwrap all ceth to eth
        FHE.allowTransient(pool.ethRaisedEncrypted, address(ceth));
        ceth.withdraw(address(this), address(this), pool.ethRaisedEncrypted);
    }
}

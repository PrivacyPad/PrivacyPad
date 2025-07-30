// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {IERC1363Receiver} from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfidentialFungibleToken} from "@openzeppelin/contracts-confidential/token/ConfidentialFungibleToken.sol";

contract ConfidentialWETH is ConfidentialFungibleToken, SepoliaConfig {
    uint8 private immutable _decimals;
    uint256 private immutable _rate;

    /// @dev Mapping from gateway decryption request ID to the address that will receive the tokens
    mapping(uint256 decryptionRequest => address) private _receivers;

    constructor() ConfidentialFungibleToken("Confidential WETH", "cWETH", "https://cweth.com") {
        _decimals = 9;
        _rate = 10 ** 9;
    }

    /// @inheritdoc ConfidentialFungibleToken
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Returns the rate at which the underlying token is converted to the wrapped token.
     * For example, if the `rate` is 1000, then 1000 units of the underlying token equal 1 unit of the wrapped token.
     */
    function rate() public view returns (uint256) {
        return _rate;
    }

    /**
     * @dev Wraps amount `amount` of the underlying token into a confidential token and sends it to
     * `to`. Tokens are exchanged at a fixed rate specified by {rate} such that `amount / rate()` confidential
     * tokens are sent. Amount transferred in is rounded down to the nearest multiple of {rate}.
     */
    function deposit(address to) public payable {
        uint256 amount = msg.value;
        require(amount > rate(), "Amount must be greater than rate");
        // refund to the caller the excess amount
        payable(msg.sender).transfer(amount % rate());
        uint64 mintAmount = SafeCast.toUint64(amount / rate());
        // mint confidential token
        _mint(to, FHE.asEuint64(mintAmount));
    }

    /**
     * @dev Unwraps tokens from `from` and sends the underlying tokens to `to`. The caller must be `from`
     * or be an approved operator for `from`. `amount * rate()` underlying tokens are sent to `to`.
     *
     * NOTE: This is an asynchronous function and waits for decryption to be completed off-chain before disbursing
     * tokens.
     * NOTE: The caller *must* already be approved by ACL for the given `amount`.
     */
    function withdraw(address from, address to, euint64 amount) public {
        require(
            FHE.isAllowed(amount, msg.sender),
            ConfidentialFungibleTokenUnauthorizedUseOfEncryptedAmount(amount, msg.sender)
        );
        _withdraw(from, to, amount);
    }

    /**
     * @dev Variant of {withdraw} that passes an `inputProof` which approves the caller for the `encryptedAmount`
     * in the ACL.
     */
    function withdraw(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public virtual {
        _withdraw(from, to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    /**
     * @dev Called by the fhEVM gateway with the decrypted amount `amount` for a request id `requestId`.
     * Fills withdraw requests.
     */
    function finalizeWithdraw(uint256 requestID, uint64 amount, bytes[] memory signatures) public virtual {
        FHE.checkSignatures(requestID, signatures);
        address to = _receivers[requestID];
        require(to != address(0), ConfidentialFungibleTokenInvalidGatewayRequest(requestID));
        delete _receivers[requestID];

        payable(to).transfer(amount * rate());
    }

    function _withdraw(address from, address to, euint64 amount) internal virtual {
        require(to != address(0), ConfidentialFungibleTokenInvalidReceiver(to));
        require(
            from == msg.sender || isOperator(from, msg.sender),
            ConfidentialFungibleTokenUnauthorizedSpender(from, msg.sender)
        );

        // try to burn, see how much we actually got
        euint64 burntAmount = _burn(from, amount);

        // decrypt that burntAmount
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = euint64.unwrap(burntAmount);
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeWithdraw.selector);

        // register who is getting the tokens
        _receivers[requestID] = to;
    }
}

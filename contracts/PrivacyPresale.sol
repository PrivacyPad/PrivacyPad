// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IPrivacyPresale} from "./interfaces/IPrivacyPresale.sol";
import {ConfidentialFungibleToken} from "@openzeppelin/contracts-confidential/token/ConfidentialFungibleToken.sol";
import {TFHESafeMath} from "@openzeppelin/contracts-confidential/utils/TFHESafeMath.sol";
import {ConfidentialTokenWrapper} from "./ConfidentialTokenWrapper.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {PrivacyPresaleLib} from "./PrivacyPresaleLib.sol";
import {ConfidentialWETH} from "./ConfidentialWETH.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";

contract PrivacyPresale is SepoliaConfig, IPrivacyPresale, Ownable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    uint256 constant MAX_LIQUIDITY_PERCENTAGE = 10000;
    // int24 constant TICK_MIN_USABLE = -887220;
    // int24 constant TICK_MAX_USABLE = 887220;
    // uint24 constant LP_FEE = 3000;

    // IWETH9 public constant weth = IWETH9(0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14);
    // INonfungiblePositionManager public constant posm =
    //     INonfungiblePositionManager(0x1238536071E1c677A632429e3655c799b22cDA52);
    /**
     * @notice Presale options
     * @param tokenDeposit Total tokens deposited for sale and liquidity.
     * @param hardCap Maximum Wei to be raised.
     * @param softCap Minimum Wei to be raised to consider the presale successful.
     * @param start Start timestamp of the presale.
     * @param end End timestamp of the presale.
     */
    struct PresaleOptions {
        uint256 tokenAddLiquidity; // in token decimal
        uint256 tokenPresale; // in token decimal
        uint256 liquidityPercentage; // max MAX_LIQUIDITY_PERCENTAGE = 100%
        uint64 hardCap;
        uint64 softCap;
        uint128 start;
        uint128 end;
    }

    /**
     * @notice Presale pool
     * @param token Address of the token to sell.
     * @param ctoken Address of the confidential token to sell.
     * @param dex
     * @param tokenBalance Token balance in this contract
     * @param tokensSoldEncrypted
     * @param tokensSold
     * @param tokensLiquidity
     * @param weiRaised
     * @param state Current state of the presale {1: Active, 2: Waiting for finalize, 3: Canceled, 4: Finalized}.
     * @param options PresaleOptions struct containing configuration for the presale.
     */
    struct Pool {
        IERC20 token;
        ConfidentialTokenWrapper ctoken;
        address dex;
        uint256 tokenBalance;
        euint64 tokensSoldEncrypted; // in ctoken decimal
        uint256 tokensSold;
        uint256 weiRaised;
        euint64 ethRaisedEncrypted; // in decimal 9
        uint64 tokenPerEthWithDecimals;
        address cweth;
        uint8 state;
        PresaleOptions options;
    }

    mapping(address => euint64) public contributions;
    mapping(address => euint64) public claimableTokens;
    mapping(address => bool) public claimed;
    mapping(address => bool) public refunded;

    Pool public pool;

    /// @notice Canceled or NOT softcapped and expired
    modifier onlyRefundable() {
        if (pool.state != 3 || (block.timestamp > pool.options.end && pool.weiRaised < pool.options.softCap))
            revert NotRefundable();
        _;
    }

    /**
     * @param _cweth Address of confidential WETH.
     * @param _token Address of the presale token.
     * @param _ctoken Address of the confidential token to sell.
     * @param _options Configuration options for the presale.
     */
    constructor(
        address _owner,
        address _cweth,
        address _token,
        address _ctoken,
        PresaleOptions memory _options
    ) Ownable(_owner) {
        _prevalidatePool(_options);

        pool.token = IERC20(_token);
        pool.ctoken = ConfidentialTokenWrapper(_ctoken);
        pool.cweth = _cweth;
        pool.options = _options;

        uint256 rate = ConfidentialTokenWrapper(_ctoken).rate();

        pool.state = 1;
        pool.tokenBalance = pool.options.tokenAddLiquidity + pool.options.tokenPresale;
        pool.tokenPerEthWithDecimals = SafeCast.toUint64(pool.options.tokenPresale / rate) / pool.options.hardCap;

        emit PoolInitialized(
            msg.sender,
            pool.options.tokenAddLiquidity + pool.options.tokenPresale,
            pool.options.tokenAddLiquidity,
            pool.options.tokenPresale,
            block.timestamp
        );
    }

    // to unwrap cweth to eth
    receive() external payable {}

    function purchase(address beneficiary, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        // Validate purchase
        require(pool.state == 1, "Invalid state");
        require(block.timestamp >= pool.options.start && block.timestamp <= pool.options.end, "Not in purchase period");

        PrivacyPresaleLib.handlePurchase(
            pool,
            contributions,
            claimableTokens,
            beneficiary,
            encryptedAmount,
            inputProof
        );
    }

    function claimTokens(address beneficiary) external {
        require(pool.state == 4, "Invalid state");
        require(!claimed[msg.sender], "Already claimed");
        claimed[msg.sender] = true;

        euint64 claimableToken = claimableTokens[msg.sender];

        FHE.allowTransient(claimableToken, address(pool.ctoken));

        // tramsfer claimable token to beneficiary
        pool.ctoken.confidentialTransfer(beneficiary, claimableToken);
    }

    function refund(address beneficiary) external {
        require(pool.state == 3, "Invalid state");
        require(!refunded[msg.sender], "Already refunded");

        FHE.allowTransient(contributions[msg.sender], address(pool.cweth));

        // transfer cweth balance to beneficiary
        ConfidentialWETH(pool.cweth).confidentialTransfer(beneficiary, contributions[msg.sender]);

        refunded[msg.sender] = true;
    }

    function _prevalidatePurchase() internal view returns (bool) {
        if (pool.state != 1) revert InvalidState(pool.state);
        if (block.timestamp < pool.options.start || block.timestamp > pool.options.end) revert NotInPurchasePeriod();
        return true;
    }

    /**
     * @param _options The presale options.
     * @return True if the pool configuration is valid.
     */
    function _prevalidatePool(PresaleOptions memory _options) internal pure returns (bool) {
        if (_options.softCap == 0) revert InvalidCapValue();
        if (_options.softCap > _options.hardCap) revert InvalidCapValue();
        if (_options.end < _options.start) revert InvalidTimestampValue();
        return true;
    }

    function requestFinalizePresaleState() external {
        PrivacyPresaleLib.handleRequestFinalizePresaleState(pool);
    }

    function finalizePreSale(
        uint256 requestID,
        uint64 ethRaised,
        uint64 tokensSold,
        bytes[] memory signatures
    ) external virtual {
        // must be at the top of the function (there in assembly relate to calldata layout int the FHE.sol)
        FHE.checkSignatures(requestID, signatures);

        PrivacyPresaleLib.handleFinalizePreSale(
            pool,
            owner(),
            ConfidentialWETH(pool.cweth),
            pool.ctoken,
            pool.token,
            ethRaised,
            tokensSold
        );
    }

    function addLiquidity() external onlyOwner {
        require(pool.state == 4, "Invalid state");

        // eth balance of pool
        uint256 ethBalance = address(this).balance;

        require(ethBalance >= pool.weiRaised, "Not enough eth");

        uint256 amountEthToAddLiquidity = (pool.weiRaised * pool.options.liquidityPercentage) /
            MAX_LIQUIDITY_PERCENTAGE;
        uint256 amountSendToPresaleOwner = pool.weiRaised - amountEthToAddLiquidity;

        // transfer eth to presale owner
        payable(owner()).transfer(amountSendToPresaleOwner);

        // amount token add to liquidity
        uint256 amountTokenToAddLiquidity = pool.token.balanceOf(address(this));

        // TODO: add liquidity
        pool.dex = PrivacyPresaleLib.addLiquidity(
            address(pool.token),
            amountTokenToAddLiquidity,
            amountEthToAddLiquidity
        );
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

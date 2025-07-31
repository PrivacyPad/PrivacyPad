// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrivacyPresale} from "./PrivacyPresale.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfidentialTokenWrapper} from "./ConfidentialTokenWrapper.sol";
import {PresaleToken} from "./PresaleToken.sol";

contract PrivacyPresaleFactory {
    using SafeERC20 for IERC20;
    address public cweth;
    // address public uniswapV2Router02;

    // Array to keep track of all created presale contracts
    address[] public allPresales;

    // Optional: mapping from creator to their presale contracts
    mapping(address creator => address[] presales) public presalesByCreator;

    // Event emitted when a new presale is created
    event PrivacyPresaleCreated(
        address indexed creator,
        address presale,
        address token,
        address ctoken,
        // address uniswapV2Router02,
        address cweth
    );

    constructor(address _cweth) {
        require(_cweth != address(0), "Invalid cweth address");
        // require(_uniswapV2Router02 != address(0), "Invalid uniswapV2Router02 address");

        cweth = _cweth;
        // uniswapV2Router02 = _uniswapV2Router02;
    }

    /**
     * @notice Deploys a new PrivacyPresale contract.
     * @param _token Address of the presale token.
     * @param _options Configuration options for the presale.
     * @return presale Address of the newly created PrivacyPresale contract.
     */
    function createPrivacyPresaleWithExistingToken(
        address _token,
        PrivacyPresale.PresaleOptions memory _options
    ) external returns (address presale) {
        // create confidential token wrapper
        ConfidentialTokenWrapper ctoken = new ConfidentialTokenWrapper(
            string(abi.encodePacked("Confidential ", IERC20Metadata(_token).name())),
            string(abi.encodePacked("c", IERC20Metadata(_token).symbol())),
            "",
            IERC20(_token)
        );

        // Deploy new PrivacyPresale contract
        PrivacyPresale newPresale = new PrivacyPresale(msg.sender, cweth, _token, address(ctoken), _options);

        // transfer token to this contract
        IERC20(_token).safeTransferFrom(
            msg.sender,
            address(newPresale),
            _options.tokenAddLiquidity + _options.tokenPresale
        );

        // Store the address
        allPresales.push(address(newPresale));
        presalesByCreator[msg.sender].push(address(newPresale));

        // Emit event
        emit PrivacyPresaleCreated(msg.sender, address(newPresale), _token, address(ctoken), cweth);

        return address(newPresale);
    }

    function createPrivacyPresaleWithNewToken(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        PrivacyPresale.PresaleOptions memory _options
    ) external returns (address presale) {
        // create new token
        PresaleToken newToken = new PresaleToken(
            _name,
            _symbol,
            _totalSupply,
            _options.tokenAddLiquidity + _options.tokenPresale,
            address(this)
        );

        // create confidential token wrapper
        ConfidentialTokenWrapper ctoken = new ConfidentialTokenWrapper(
            string(abi.encodePacked("Confidential ", _name)),
            string(abi.encodePacked("c", _symbol)),
            "",
            IERC20(address(newToken))
        );

        // Deploy new PrivacyPresale contract
        PrivacyPresale newPresale = new PrivacyPresale(msg.sender, cweth, address(newToken), address(ctoken), _options);

        // transfer token to presale contract
        newToken.transfer(address(newPresale), _options.tokenAddLiquidity + _options.tokenPresale);

        // Store the address
        allPresales.push(address(newPresale));
        presalesByCreator[msg.sender].push(address(newPresale));

        // Emit event
        emit PrivacyPresaleCreated(msg.sender, address(newPresale), address(newToken), address(ctoken), cweth);

        return address(newPresale);
    }

    /**
     * @notice Returns the number of presales created.
     */
    function getPresalesCount() external view returns (uint256) {
        return allPresales.length;
    }

    /**
     * @notice Returns all presale addresses.
     */
    function getAllPresales() external view returns (address[] memory) {
        return allPresales;
    }

    /**
     * @notice Returns all presales created by a specific address.
     */
    function getPresalesByCreator(address creator) external view returns (address[] memory) {
        return presalesByCreator[creator];
    }
}

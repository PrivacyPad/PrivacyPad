// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TokenFactory
 * @dev Factory contract for creating ERC20 tokens with customizable parameters.
 * This factory uses the clone pattern to deploy new tokens efficiently.
 */
contract TokenFactory {
    // Events to track token creation
    event TokenCreated(
        address indexed tokenAddress,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        string url,
        address indexed creator
    );

    // Array to store all created token addresses
    address[] public createdTokens;

    // Mapping to track token creators
    mapping(address token => address creator) public tokenCreators;

    /**
     * @dev Creates a new ERC20 token with the specified parameters.
     * @param name The name of the token
     * @param symbol The symbol of the token
     * @param decimals The number of decimals for the token
     * @param totalSupply The total supply of the token
     * @param url The URL for additional token metadata
     * @return tokenAddress The address of the newly created token
     */
    function createToken(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 totalSupply,
        string memory url
    ) external returns (address tokenAddress) {
        // Create new token contract
        FactoryToken newToken = new FactoryToken(name, symbol, decimals, totalSupply, url, msg.sender);

        tokenAddress = address(newToken);

        // Store token information
        createdTokens.push(tokenAddress);
        tokenCreators[tokenAddress] = msg.sender;

        // Emit event
        emit TokenCreated(tokenAddress, name, symbol, decimals, totalSupply, url, msg.sender);

        return tokenAddress;
    }

    /**
     * @dev Returns tokens created by a specific address.
     * @param creator The address of the token creator
     * @return Array of token addresses created by the specified address
     */
    function getTokensByCreator(address creator) external view returns (address[] memory) {
        uint256 count = 0;

        // Count tokens created by this address
        for (uint256 i = 0; i < createdTokens.length; i++) {
            if (tokenCreators[createdTokens[i]] == creator) {
                count++;
            }
        }

        // Create array with correct size
        address[] memory tokens = new address[](count);
        uint256 index = 0;

        // Fill array with token addresses
        for (uint256 i = 0; i < createdTokens.length; i++) {
            if (tokenCreators[createdTokens[i]] == creator) {
                tokens[index] = createdTokens[i];
                index++;
            }
        }

        return tokens;
    }
}

/**
 * @title FactoryToken
 * @dev ERC20 token implementation created by the TokenFactory.
 * This token implements IERC20Metadata interface and includes additional metadata like URL.
 * The token is owned by the creator and follows ERC20 standards.
 */
contract FactoryToken is ERC20, Ownable {
    // Token metadata
    string public tokenUrl;
    uint8 private _decimals;

    /**
     * @dev Constructor for creating a new token.
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param decimals_ The number of decimals for the token
     * @param totalSupply_ The total supply of the token
     * @param url_ The URL for additional token metadata
     * @param creator_ The address that will own the token initially
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 totalSupply_,
        string memory url_,
        address creator_
    ) ERC20(name_, symbol_) Ownable(creator_) {
        // Set token properties
        _decimals = decimals_;
        tokenUrl = url_;

        // Mint total supply to the creator
        _mint(creator_, totalSupply_);
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * @return The number of decimals
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Internal function to convert uint256 to string.
     * @param value The uint256 value to convert
     * @return The string representation
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

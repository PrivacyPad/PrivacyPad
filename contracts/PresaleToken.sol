// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title PresaleToken
 * @dev Simple ERC20 token for presale, mints total supply to the presale contract.
 */
contract PresaleToken is ERC20 {
    /**
     * @dev Constructor mints total supply to the presale contract.
     * @param name_ Name of the token
     * @param symbol_ Symbol of the token
     * @param totalSupply_ Total supply to mint (in wei)
     * @param presaleAddress Address of the presale contract (recipient)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        uint256 presaleSupply_,
        address presaleAddress
    ) ERC20(name_, symbol_) {
        // Mint presale supply to the presale contract
        _mint(presaleAddress, presaleSupply_);

        // Mint remaining supply to the owner
        _mint(msg.sender, totalSupply_ - presaleSupply_);
    }
}

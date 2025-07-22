// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.26;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    ConfidentialFungibleTokenERC20Wrapper
} from "@openzeppelin/contracts-confidential/token/extensions/ConfidentialFungibleTokenERC20Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

import {ConfidentialFungibleToken} from "@openzeppelin/contracts-confidential/token/ConfidentialFungibleToken.sol";

contract ConfidentialTokenWrapper is SepoliaConfig, ConfidentialFungibleTokenERC20Wrapper {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory tokenURI_,
        IERC20 underlying_
    ) ConfidentialFungibleTokenERC20Wrapper(underlying_) ConfidentialFungibleToken(name_, symbol_, tokenURI_) {}
}

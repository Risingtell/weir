// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test double for USDT: six decimals and, importantly, an address
///         blocklist. Tether really can freeze an address, and when it does,
///         `transfer` reverts. That is the realistic way a payout fails, since
///         a plain ERC-20 transfer never executes code on the recipient and so
///         a recipient cannot reject a payment by reverting.
contract MockUSDT is ERC20 {
    mapping(address => bool) public isBlocked;

    constructor() ERC20("Mock Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool blocked) external {
        isBlocked[account] = blocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!isBlocked[from] && !isBlocked[to], "USDT: blocked address");
        super._update(from, to, value);
    }
}

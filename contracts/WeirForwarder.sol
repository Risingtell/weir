// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title WeirForwarder
/// @notice The trusted forwarder that lets a user act without holding gas.
///
/// @dev Weir's users hold stablecoins and no POL. Asking a freelancer in Lagos
///      to go and acquire a gas token before they can be paid would lose most
///      of them at the first step, so every user action is relayable.
///
///      This is OpenZeppelin's audited implementation with a Weir name for the
///      EIP-712 domain. The relayer submits requests and pays the gas, but it
///      cannot forge one: the forwarder verifies the user's signature and
///      appends their address, so a relayed call can never impersonate anyone.
contract WeirForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("Weir") {}
}

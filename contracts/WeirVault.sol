// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title WeirVault
/// @notice A savings address you cannot raid on a bad day.
///
/// @dev This is the "pay yourself first" half of Weir. It is just another
///      recipient in a WeirRoute split, so a slice of every incoming payment
///      lands here before it ever reaches a spending wallet. The lock can be
///      extended but never shortened, which is the whole point: the commitment
///      has to outlast the moment you want to break it.
contract WeirVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    uint64 public unlockAt;
    string public goal;

    event VaultOpened(address indexed owner, uint64 unlockAt, string goal);
    event LockExtended(uint64 previousUnlockAt, uint64 newUnlockAt);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error StillLocked(uint64 unlockAt, uint64 nowAt);
    error CannotShortenLock();
    error UnlockMustBeFuture();
    error ZeroAddress();
    error NothingToWithdraw();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, uint64 unlockAt_, string calldata goal_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        if (unlockAt_ <= block.timestamp) revert UnlockMustBeFuture();
        owner = owner_;
        unlockAt = unlockAt_;
        goal = goal_;
        emit VaultOpened(owner_, unlockAt_, goal_);
    }

    function locked() external view returns (bool) {
        return block.timestamp < unlockAt;
    }

    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Push the unlock date further out. There is deliberately no way back.
    function extendLock(uint64 newUnlockAt) external onlyOwner {
        if (newUnlockAt <= unlockAt) revert CannotShortenLock();
        emit LockExtended(unlockAt, newUnlockAt);
        unlockAt = newUnlockAt;
    }

    function withdraw(address token) external onlyOwner nonReentrant {
        if (block.timestamp < unlockAt) revert StillLocked(unlockAt, uint64(block.timestamp));
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();
        IERC20(token).safeTransfer(owner, amount);
        emit Withdrawn(token, owner, amount);
    }
}

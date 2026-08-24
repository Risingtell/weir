// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

interface IWeirIndex {
    function indexRecipients(address[] calldata accounts) external;
}

/// @title WeirRoute
/// @notice A payment address that splits whatever lands in it between fixed
///         recipients, according to rules its owner sets in advance.
///
/// @dev Each user gets their own clone of this contract, so a payer can send a
///      plain ERC-20 transfer from any wallet or exchange without knowing that
///      Weir exists. ERC-20 transfers do not notify the recipient contract, so
///      nothing can execute on arrival. Instead `distribute` is permissionless:
///      a relayer normally calls it within seconds, but any recipient can call
///      it themselves, so funds are never trapped behind an off-chain service.
contract WeirRoute is Initializable, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_BPS = 10_000;
    uint256 public constant MAX_RECIPIENTS = 20;

    struct Share {
        address account;
        uint96 bps;
    }

    address public owner;

    /// @notice The factory that created this route, notified when rules change
    ///         so a newly added recipient can still discover this route.
    address public factory;

    Share[] private _shares;

    /// @notice Amounts owed to a recipient whose transfer failed, claimable by them.
    mapping(address token => mapping(address account => uint256)) public pending;

    event RulesSet(Share[] shares);
    event Distributed(address indexed token, uint256 total);
    event Paid(address indexed token, address indexed to, uint256 amount);
    event PaymentDeferred(address indexed token, address indexed to, uint256 amount);
    event Claimed(address indexed token, address indexed to, uint256 amount);
    event OwnerTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotSelf();
    error NoRecipients();
    error TooManyRecipients();
    error ZeroAddressRecipient();
    error ZeroShare();
    error SharesMustSumToTotal(uint256 got);
    error NothingToDistribute();
    error NothingToClaim();

    modifier onlyOwner() {
        if (_msgSender() != owner) revert NotOwner();
        _;
    }

    /// @param forwarder the trusted ERC-2771 forwarder. Weir's audience holds
    ///        stablecoins and no gas token, so every owner action has to work
    ///        for someone with an empty POL balance. Immutable, which is what
    ///        makes it survive being read through a minimal proxy.
    constructor(address forwarder) ERC2771Context(forwarder) {
        // The implementation itself must never be initializable through a clone.
        _disableInitializers();
    }

    function initialize(address owner_, Share[] memory shares_) public initializer {
        if (owner_ == address(0)) revert ZeroAddressRecipient();
        owner = owner_;
        factory = msg.sender;
        _setRules(shares_);
        emit OwnerTransferred(address(0), owner_);
    }

    // --- rules ---

    function shares() external view returns (Share[] memory) {
        return _shares;
    }

    function shareCount() external view returns (uint256) {
        return _shares.length;
    }

    /// @notice Replace the split. Applies to funds distributed from now on.
    function setRules(Share[] calldata shares_) external onlyOwner {
        _setRules(shares_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddressRecipient();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _setRules(Share[] memory shares_) private {
        uint256 n = shares_.length;
        if (n == 0) revert NoRecipients();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients();

        delete _shares;
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            Share memory s = shares_[i];
            if (s.account == address(0)) revert ZeroAddressRecipient();
            if (s.bps == 0) revert ZeroShare();
            sum += s.bps;
            _shares.push(s);
        }
        if (sum != TOTAL_BPS) revert SharesMustSumToTotal(sum);

        // Tell the factory about anyone newly added, so they can find this
        // route. Best effort: a failure here must never block a rules change.
        if (factory != address(0)) {
            address[] memory accounts = new address[](n);
            for (uint256 i; i < n; ++i) {
                accounts[i] = shares_[i].account;
            }
            try IWeirIndex(factory).indexRecipients(accounts) {} catch {}
        }

        emit RulesSet(shares_);
    }

    // --- distribution ---

    /// @notice Split the contract's entire balance of `token` between the recipients.
    /// @dev Permissionless by design. Any recipient can trigger their own payout.
    function distribute(address token) external nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert NothingToDistribute();

        uint256 n = _shares.length;
        uint256 distributed;

        // Rounding dust would otherwise be stranded, so the last recipient
        // absorbs the remainder rather than leaving it in the contract.
        for (uint256 i; i < n; ++i) {
            Share memory s = _shares[i];
            uint256 amount = i == n - 1 ? balance - distributed : (balance * s.bps) / TOTAL_BPS;
            distributed += amount;
            if (amount != 0) _payOrDefer(token, s.account, amount);
        }

        emit Distributed(token, balance);
    }

    /// @notice Withdraw funds a failed transfer left owed to you.
    function claim(address token) external nonReentrant {
        address claimant = _msgSender();
        uint256 amount = pending[token][claimant];
        if (amount == 0) revert NothingToClaim();
        pending[token][claimant] = 0;
        IERC20(token).safeTransfer(claimant, amount);
        emit Claimed(token, claimant, amount);
    }

    /// @dev A recipient that reverts on receipt must not brick the whole split
    ///      for everyone else, so their share is set aside for them to pull.
    function _payOrDefer(address token, address to, uint256 amount) private {
        try this.selfTransfer(token, to, amount) {
            emit Paid(token, to, amount);
        } catch {
            pending[token][to] += amount;
            emit PaymentDeferred(token, to, amount);
        }
    }

    /// @dev External only so the call above can be wrapped in try/catch.
    ///      Deliberately `msg.sender`, not `_msgSender()`: this must only ever
    ///      be callable by this contract itself, never by a forwarded caller.
    function selfTransfer(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert NotSelf();
        IERC20(token).safeTransfer(to, amount);
    }
}

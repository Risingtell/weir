// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {WeirRoute} from "./WeirRoute.sol";
import {WeirVault} from "./WeirVault.sol";

/// @title WeirFactory
/// @notice Hands each user their own payment address and their own savings vault.
/// @dev Minimal proxies keep deployment cheap enough that a new user creating a
///      route on a phone is not a barrier. The indexes exist so the mini app and
///      the relayer can rebuild a user's state from chain alone, with no server.
contract WeirFactory is ERC2771Context {
    address public immutable routeImplementation;
    address public immutable vaultImplementation;

    mapping(address owner => address[] routes) private _routesOf;
    mapping(address owner => address[] vaults) private _vaultsOf;
    address[] private _allRoutes;

    /// @notice Every route a given address is paid by, so a teammate can find
    ///         splits they are part of without being told the address.
    mapping(address recipient => address[] routes) private _routesPaying;

    /// @notice Routes this factory created, so only they can update the index.
    mapping(address route => bool) public isRoute;

    /// @notice Vaults this factory created. A relayer paying gas on a user's
    ///         behalf uses this to refuse anything that is not one of ours.
    mapping(address vault => bool) public isVault;
    mapping(address recipient => mapping(address route => bool)) private _indexed;

    event RouteCreated(address indexed route, address indexed owner, WeirRoute.Share[] shares);
    event VaultCreated(address indexed vault, address indexed owner, uint64 unlockAt, string goal);

    error SaveShareOutOfRange(uint96 saveBps);
    error NotAKnownRoute();

    /// @param forwarder trusted ERC-2771 forwarder, shared with both
    ///        implementations so every user action can be relayed. Weir's users
    ///        hold stablecoins and no gas token, and asking them to go and
    ///        acquire POL before their first action would lose most of them.
    /// @param settlementBounty paid out of each payment to whoever triggers the
    ///        split, so settlement funds itself instead of being subsidised.
    constructor(address forwarder, uint256 settlementBounty) ERC2771Context(forwarder) {
        routeImplementation = address(new WeirRoute(forwarder, settlementBounty));
        vaultImplementation = address(new WeirVault(forwarder));
    }

    function createRoute(WeirRoute.Share[] calldata shares) external returns (address route) {
        address owner_ = _msgSender();
        route = Clones.clone(routeImplementation);
        WeirRoute(route).initialize(owner_, shares);

        _routesOf[owner_].push(route);
        _allRoutes.push(route);
        isRoute[route] = true;
        for (uint256 i; i < shares.length; ++i) {
            _index(shares[i].account, route);
        }

        emit RouteCreated(route, owner_, shares);
    }

    function createVault(uint64 unlockAt, string calldata goal) public returns (address vault) {
        address owner_ = _msgSender();
        vault = Clones.clone(vaultImplementation);
        WeirVault(vault).initialize(owner_, unlockAt, goal);

        _vaultsOf[owner_].push(vault);
        isVault[vault] = true;
        emit VaultCreated(vault, owner_, unlockAt, goal);
    }

    /// @notice Open a savings vault and a route that feeds it, in one transaction.
    /// @dev The whole "pay yourself first" setup is two contracts, which would
    ///      otherwise mean two wallet confirmations before a new user has seen
    ///      anything work. Doing it in one call is the difference between an
    ///      onboarding that lands and one that gets abandoned halfway.
    /// @param spendTo where the spendable remainder goes, usually your own wallet
    /// @param saveBps the slice to lock away, in basis points
    function createSavingsRoute(
        address spendTo,
        uint96 saveBps,
        uint64 unlockAt,
        string calldata goal
    ) external returns (address route, address vault) {
        if (saveBps == 0 || saveBps >= 10_000) revert SaveShareOutOfRange(saveBps);

        address owner_ = _msgSender();
        vault = createVault(unlockAt, goal);

        WeirRoute.Share[] memory shares = new WeirRoute.Share[](2);
        shares[0] = WeirRoute.Share({account: spendTo, bps: uint96(10_000) - saveBps});
        shares[1] = WeirRoute.Share({account: vault, bps: saveBps});

        route = Clones.clone(routeImplementation);
        WeirRoute(route).initialize(owner_, shares);

        _routesOf[owner_].push(route);
        _allRoutes.push(route);
        isRoute[route] = true;
        _index(spendTo, route);
        _index(vault, route);

        emit RouteCreated(route, owner_, shares);
    }

    /// @notice Called by a route when its rules change, so someone added to a
    ///         split later can still discover it. Without this the index would
    ///         only ever reflect a route's original recipients, and a teammate
    ///         added afterwards would have no way to find the route paying them.
    function indexRecipients(address[] calldata accounts) external {
        if (!isRoute[msg.sender]) revert NotAKnownRoute();
        for (uint256 i; i < accounts.length; ++i) {
            _index(accounts[i], msg.sender);
        }
    }

    function _index(address recipient, address route) private {
        if (_indexed[recipient][route]) return;
        _indexed[recipient][route] = true;
        _routesPaying[recipient].push(route);
    }

    function routesOf(address owner) external view returns (address[] memory) {
        return _routesOf[owner];
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    function routesPaying(address recipient) external view returns (address[] memory) {
        return _routesPaying[recipient];
    }

    function totalRoutes() external view returns (uint256) {
        return _allRoutes.length;
    }

    function allRoutes(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = _allRoutes.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        page = new address[](end - offset);
        for (uint256 i; i < page.length; ++i) {
            page[i] = _allRoutes[offset + i];
        }
    }
}

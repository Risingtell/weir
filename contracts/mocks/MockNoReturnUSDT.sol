// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @notice Test double for the real USDT deployed on Ethereum mainnet, whose
///         `transfer` returns nothing at all rather than a bool. A contract
///         using the plain IERC20 interface reverts when decoding that empty
///         return, which is exactly why Weir routes every transfer through
///         SafeERC20. This mock exists to prove that path works.
contract MockNoReturnUSDT {
    string public constant name = "Mock Tether USD (no return)";
    string public constant symbol = "USDT";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    /// @dev Deliberately returns no value.
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    /// @dev Deliberately returns no value.
    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not allowed");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }
}

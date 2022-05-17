// SPDX-License-Identifier: MIT

pragma solidity =0.5.16;

import './interfaces/IUniswapV2ERC20.sol';
import './libraries/SafeMath.sol';

contract UniswapV2ERC20 is IUniswapV2ERC20 {
	// =====================================================
	//    Labraries
	// =====================================================

	using SafeMath for uint256;

	// =====================================================
	//    Variables
	// =====================================================

	string public constant name = 'Uniswap V2';
	string public constant symbol = 'UNI-V2';
	uint8 public constant decimals = 18;

	uint256 public totalSupply;

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	// This hash is the identifier for the transaction type.
	bytes32 public DOMAIN_SEPARATOR;

	// keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
	bytes32 public constant PERMIT_TYPEHASH =
		0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

	// It is not feasible for a recipient to fake a digital signature.
	// However, it is trivial to send the same transaction twice (this is a form of replay attack).
	// To prevent this, we use a nonce.
	// If the nonce of a new Permit is not one more than the last one used, we assume it is invalid.
	mapping(address => uint256) public nonces;

	// =====================================================
	//    Events
	// =====================================================

	event Approval(address indexed owner, address indexed spender, uint256 value);
	event Transfer(address indexed from, address indexed to, uint256 value);

	// =====================================================
	//    Setup Functions
	// =====================================================

	// This is the code to retrieve the chain identifier.
	// It uses an EVM assembly dialect called Yul.
	// Note that in the current version of Yul you have to use chainid(), not chainid.
	constructor() public {
		uint256 chainId;
		assembly {
			chainId := chainid
		}

		// Calculate the domain separator for EIP-712.
		DOMAIN_SEPARATOR = keccak256(
			abi.encode(
				keccak256(
					'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
				),
				keccak256(bytes(name)),
				keccak256(bytes('1')),
				chainId,
				address(this)
			)
		);
	}

	// =====================================================
	//    Internally Functions
	// =====================================================

	function _mint(address to, uint256 value) internal {
		totalSupply = totalSupply.add(value);
		balanceOf[to] = balanceOf[to].add(value);
		emit Transfer(address(0), to, value);
	}

	function _burn(address from, uint256 value) internal {
		balanceOf[from] = balanceOf[from].sub(value);
		totalSupply = totalSupply.sub(value);
		emit Transfer(from, address(0), value);
	}

	function _approve(
		address owner,
		address spender,
		uint256 value
	) private {
		allowance[owner][spender] = value;
		emit Approval(owner, spender, value);
	}

	function _transfer(
		address from,
		address to,
		uint256 value
	) private {
		balanceOf[from] = balanceOf[from].sub(value);
		balanceOf[to] = balanceOf[to].add(value);
		emit Transfer(from, to, value);
	}

	// =====================================================
	//    Externally Functions
	// =====================================================

	function approve(address spender, uint256 value) external returns (bool) {
		_approve(msg.sender, spender, value);
		return true;
	}

	function transfer(address to, uint256 value) external returns (bool) {
		_transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(
		address from,
		address to,
		uint256 value
	) external returns (bool) {
		if (allowance[from][msg.sender] != uint256(-1)) {
			allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
		}
		_transfer(from, to, value);
		return true;
	}

	// This is the function that implements the permissions.
	// It receives as parameters the relevant fields, and the three scalar values for the signature (v, r, and s).
	function permit(
		address owner,
		address spender,
		uint256 value,
		uint256 deadline,
		uint8 v,
		bytes32 r,
		bytes32 s
	) external {
		// Don't accept transactions after the deadline.
		require(deadline >= block.timestamp, 'UniswapV2: EXPIRED');

		// Is the message we expect to get.
		// We know what the nonce should be, so there is no need for us to get it as a parameter
		bytes32 digest = keccak256(
			abi.encodePacked(
				'\x19\x01',
				DOMAIN_SEPARATOR,
				keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
			)
		);

		address recoveredAddress = ecrecover(digest, v, r, s);

		require(
			recoveredAddress != address(0) && recoveredAddress == owner,
			'UniswapV2: INVALID_SIGNATURE'
		);

		_approve(owner, spender, value);
	}
}

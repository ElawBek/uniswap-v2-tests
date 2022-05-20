// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

contract TokenWith6Decimals is ERC20, Ownable {
	constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
		_mint(msg.sender, 100 * 10**decimals());
	}

	function mint(address to, uint256 amount) public onlyOwner {
		_mint(to, amount);
	}

	function decimals() public pure override returns (uint8) {
		return 6;
	}
}

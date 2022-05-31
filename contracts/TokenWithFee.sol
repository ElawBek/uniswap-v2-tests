// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenWithFee is ERC20, Ownable {
  constructor(string memory _name, string memory _symbol)
    ERC20(_name, _symbol)
  {
    _mint(msg.sender, 100 * 10**decimals());
  }

  function mint(address to, uint256 amount) public onlyOwner {
    _mint(to, amount);
  }

  // Just simple fee
  function _transfer(
    address from,
    address to,
    uint256 amount
  ) internal override {
    uint256 amountWithFee;
    unchecked {
      amountWithFee = (amount * 997) / 1000;
    }

    super._transfer(from, to, amountWithFee);
    super._transfer(from, owner(), amount - amountWithFee);
  }
}

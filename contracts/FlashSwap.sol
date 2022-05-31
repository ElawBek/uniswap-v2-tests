// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./coreContracts/interfaces/IUniswapV2Factory.sol";
import "./coreContracts/interfaces/IUniswapV2Pair.sol";
import "./coreContracts/interfaces/IUniswapV2Callee.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FlashSwap is IUniswapV2Callee {
  address public immutable factory;

  event Log(string message, uint256 value);

  constructor(address _factory) {
    factory = _factory;
  }

  function flashSwap(
    address _tokenBorrow,
    address _secondToken,
    uint256 _amount
  ) external {
    address pair = IUniswapV2Factory(factory).getPair(
      _tokenBorrow,
      _secondToken
    );

    // only pair can call this function
    require(pair != address(0), "!pair");

    address token0 = IUniswapV2Pair(pair).token0();
    address token1 = IUniswapV2Pair(pair).token1();

    // selects which token will be used in the flashSwap
    uint256 amount0Out = _tokenBorrow == token0 ? _amount : 0;
    uint256 amount1Out = _tokenBorrow == token1 ? _amount : 0;

    // need to pass some data to trigger uniswapV2Call
    bytes memory data = abi.encode(_tokenBorrow, _amount);

    IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), data);
  }

  function uniswapV2Call(
    address sender,
    uint256 amount0,
    uint256 amount1,
    bytes calldata data
  ) external override {
    address token0 = IUniswapV2Pair(msg.sender).token0();
    address token1 = IUniswapV2Pair(msg.sender).token1();
    address pair = IUniswapV2Factory(factory).getPair(token0, token1);

    require(msg.sender == pair, "FlashSwap: wrong pair");
    require(sender == address(this), "FlashSwap: wrong sender");

    // decode input data
    (address tokenBorrow, uint256 amount) = abi.decode(
      data,
      (address, uint256)
    );

    // about 0.3%
    uint256 fee = ((amount * 3) / 997) + 1;
    uint256 amountToRepay = amount + fee;

    // do stuff here
    emit Log("amount", amount); // the amount of the requested token
    emit Log("amount0", amount0);
    emit Log("amount1", amount1);
    emit Log("fee", fee);
    emit Log("amount to repay", amountToRepay); // amount of token to be returned

    IERC20(tokenBorrow).transfer(pair, amountToRepay);
  }
}

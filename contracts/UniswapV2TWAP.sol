// SPDX-License-Identifier: MIT

pragma solidity 0.6.6;

import "./peripheryContracts/helpers/libraries/FixedPoint.sol";

import "./coreContracts/interfaces/IUniswapV2Pair.sol";
import "./peripheryContracts/libraries/UniswapV2Library.sol";
import "./peripheryContracts/libraries/UniswapV2OracleLibrary.sol";

contract UniswapV2TWAP {
  using FixedPoint for *;

  // minimum time that we need to wait before update the TWAP
  // for tests 10 seconds. For mainnet - 30 minutes or more
  uint256 public constant PERIOD = 10;

  // Pair and its tokens
  IUniswapV2Pair public immutable pair;
  address public immutable token0;
  address public immutable token1;

  uint256 public price0CumulativeLast;
  uint256 public price1CumulativeLast;
  uint32 public blockTimestampLast;

  // TWAP for tokens
  // binary fixed point numbers
  // range: [0, 2**112 - 1]
  // resolution: 1 / 2**112
  FixedPoint.uq112x112 public price0Average;
  FixedPoint.uq112x112 public price1Average;

  constructor(IUniswapV2Pair _pair) public {
    pair = _pair;
    token0 = _pair.token0();
    token1 = _pair.token1();
    (, , blockTimestampLast) = _pair.getReserves();
    price0CumulativeLast = _pair.price0CumulativeLast();
    price1CumulativeLast = _pair.price1CumulativeLast();
  }

  function update() external {
    (
      uint256 price0Cumulative,
      uint256 price1Cumulative,
      uint32 blockTimestamp
    ) = UniswapV2OracleLibrary.currentCumulativePrices(address(pair));

    uint256 timeElapsed = blockTimestamp - blockTimestampLast;

    require(timeElapsed >= PERIOD, "Time elapsed < min period");

    price0Average = FixedPoint.uq112x112(
      uint224((price0Cumulative - price0CumulativeLast) / timeElapsed)
    );

    price1Average = FixedPoint.uq112x112(
      uint224((price1Cumulative - price1CumulativeLast) / timeElapsed)
    );

    price0CumulativeLast = price0Cumulative;
    price1CumulativeLast = price1Cumulative;
    blockTimestampLast = blockTimestamp;
  }

  function consult(address token, uint256 amountIn)
    external
    view
    returns (uint256 amountOut)
  {
    require(token == token0 || token == token1, "invalid token");

    if (token == token0) {
      //  using FixedPoint for *
      //  mul returns uq144x112
      //  decode144 decodes uq144x112 to uint144
      amountOut = price0Average.mul(amountIn).decode144();
    } else {
      amountOut = price1Average.mul(amountIn).decode144();
    }
  }
}

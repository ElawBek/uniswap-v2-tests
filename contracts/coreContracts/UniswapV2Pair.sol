// SPDX-License-Identifier: MIT

pragma solidity =0.5.16;

import "./interfaces/IUniswapV2Pair.sol";
import "./UniswapV2ERC20.sol";
import "./libraries/Math.sol";
import "./libraries/SafeMath.sol";
import "./libraries/UQ112x112.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IUniswapV2Callee.sol";

contract UniswapV2Pair is IUniswapV2Pair, UniswapV2ERC20 {
  // =====================================================
  //    Labraries
  // =====================================================

  using SafeMath for uint256;

  // A lot of calculations in the pool contract require fractions.
  // However, fractions are not supported by the EVM.
  // The solution that Uniswap found is to use 224 bit values, with 112 bits for the integer part, and 112 bits for the fraction.
  // So 1.0 is represented as 2^112, 1.5 is represented as 2^112 + 2^111, etc
  using UQ112x112 for uint224;

  // =====================================================
  //    Variables
  // =====================================================

  // To avoid cases of division by zero, there is a minimum number of liquidity tokens that always exist (but are owned by account zero).
  // That number is MINIMUM_LIQUIDITY, a thousand.
  uint256 public constant MINIMUM_LIQUIDITY = 10**3;

  // This is the ABI selector for the ERC-20 transfer function.
  // It is used to transfer ERC-20 tokens in the two token accounts.
  // bytes4(keccak256(bytes('transfer(address,uint256)')));
  bytes4 private constant SELECTOR = 0xa9059cbb;

  // This is the factory contract that created this pool.
  // Every pool is an exchange between two ERC-20 tokens, the factory is a central point that connects all of these pools.
  address public factory;

  // There are the addresses of the contracts for the two types of ERC-20 tokens that can be exchanged by this pool.
  address public token0;
  address public token1;

  // One of the biggest gas expenses of Ethereum contracts is storage, which persists from one call of the contract to the next.
  // Each storage cell is 256 bits long.
  // So three variables, reserve0, reserve1, and blockTimestampLast,
  // are allocated in such a way a single storage value can include all three of them (112+112+32=256).

  // The reserves the pool has for each token type.
  // We assume that the two represent the same amount of value, and therefore each token0 is worth reserve1/reserve0 token1's.
  uint112 private reserve0; // uses single storage slot, accessible via getReserves
  uint112 private reserve1; // uses single storage slot, accessible via getReserves

  // The timestamp for the last block in which an exchange occurred, used to track exchange rates across time.
  uint32 private blockTimestampLast; // uses single storage slot, accessible via getReserves

  // These variables hold the cumulative costs for each token (each in term of the other).
  // They can be used to calculate the average exchange rate over a period of time.
  uint256 public price0CumulativeLast;
  uint256 public price1CumulativeLast;

  //The way the pair exchange decides on the exchange rate between token0 and token1 is to keep the multiple of the two reserves constant during trades.
  // kLast is this value.
  //It changes when a liquidity provider deposits or withdraws tokens, and it increases slightly because of the 0.3% market fee.
  uint256 public kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event

  // =====================================================
  //    Lock
  // =====================================================

  // Variable for preventing reentrancy-attacks
  uint256 private unlocked = 1;

  modifier lock() {
    // If unlocked is equal to one, set it to zero. If it is already zero revert the call, make it fail.
    require(unlocked == 1, "UniswapV2: LOCKED");
    unlocked = 0;
    _;
    unlocked = 1;
  }

  // =====================================================
  //    Misc. functions
  // =====================================================

  // This function provides callers with the current state of the exchange. Notice that Solidity functions can return multiple values.
  function getReserves()
    public
    view
    returns (
      uint112 _reserve0,
      uint112 _reserve1,
      uint32 _blockTimestampLast
    )
  {
    _reserve0 = reserve0;
    _reserve1 = reserve1;
    _blockTimestampLast = blockTimestampLast;
  }

  // This internal function transfers an amount of ERC20 tokens from the exchange to somebody else.
  function _safeTransfer(
    address token,
    address to,
    uint256 value
  ) private {
    (bool success, bytes memory data) = token.call(
      abi.encodeWithSelector(SELECTOR, to, value)
    );
    require(
      success && (data.length == 0 || abi.decode(data, (bool))),
      "UniswapV2: TRANSFER_FAILED"
    );
  }

  // =====================================================
  //    Events
  // =====================================================

  // These two events are emitted when a liquidity provider either deposits liquidity (Mint) or withdraws it (Burn)
  // In either case, the amounts of token0 and token1 that are deposited or withdrawn are part of the event,
  // as well as the identity of the account that called us (sender).
  // In the case of a withdrawal, the event also includes the target that received the tokens (to), which may not be the same as the sender.
  event Mint(address indexed sender, uint256 amount0, uint256 amount1);
  event Burn(
    address indexed sender,
    uint256 amount0,
    uint256 amount1,
    address indexed to
  );

  // This event is emitted when a trader swaps one token for the other.
  // Again, the sender and the destination may not be the same. Each token may be either sent to the exchange, or received from it.
  event Swap(
    address indexed sender,
    uint256 amount0In,
    uint256 amount1In,
    uint256 amount0Out,
    uint256 amount1Out,
    address indexed to
  );

  // Finally, Sync is emitted every time tokens are added or withdrawn,
  // regardless of the reason, to provide the latest reserve information
  event Sync(uint112 reserve0, uint112 reserve1);

  // =====================================================
  //    Setup Functions
  // =====================================================

  constructor() public {
    factory = msg.sender;
  }

  // Called once by the factory at time of deployment
  function initialize(address _token0, address _token1) external {
    require(msg.sender == factory, "UniswapV2: FORBIDDEN"); // sufficient check
    token0 = _token0;
    token1 = _token1;
  }

  // =====================================================
  //    Internal Update Functions
  // =====================================================

  // This function is called every time tokens are deposited or withdrawn.

  // Update reserves and, on the first call per block, price accumulators
  function _update(
    uint256 balance0,
    uint256 balance1,
    uint112 _reserve0,
    uint112 _reserve1
  ) private {
    require(
      balance0 <= uint112(-1) && balance1 <= uint112(-1),
      "UniswapV2: OVERFLOW"
    );

    uint32 blockTimestamp = uint32(block.timestamp % 2**32);
    uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
    if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
      // We want to calculate the average price of Token0 between the timestamps 5,030 and 5,150.
      // The difference in the value of price0Cumulative is 143.702-29.07=114.632.
      // This is the average across two minutes (120 seconds). So the average price is 114.632/120 = 0.955.

      // This price calculation is the reason we need to know the old reserve sizes.
      price0CumulativeLast +=
        uint256(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) *
        timeElapsed;
      price1CumulativeLast +=
        uint256(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) *
        timeElapsed;
    }
    reserve0 = uint112(balance0);
    reserve1 = uint112(balance1);
    blockTimestampLast = blockTimestamp;

    emit Sync(reserve0, reserve1);
  }

  // In Uniswap 2.0 traders pay a 0.30% fee to use the market.
  // Most of that fee (0.25% of the trade) always goes to the liquidity providers.
  // The remaining 0.05% can go either to the liquidity providers or to an address specified by the factory as a protocol fee,
  // which pays Uniswap for their development effort.

  // To reduce calculations (and therefore gas costs), this fee is only calculated when liquidity is added or removed from the pool,
  // rather than at each transaction.

  // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
  function _mintFee(uint112 _reserve0, uint112 _reserve1)
    private
    returns (bool feeOn)
  {
    address feeTo = IUniswapV2Factory(factory).feeTo();

    feeOn = feeTo != address(0);

    uint256 _kLast = kLast; // gas savings

    if (feeOn) {
      if (_kLast != 0) {
        uint256 rootK = Math.sqrt(uint256(_reserve0).mul(_reserve1));
        uint256 rootKLast = Math.sqrt(_kLast);

        if (rootK > rootKLast) {
          uint256 numerator = totalSupply.mul(rootK.sub(rootKLast));
          uint256 denominator = rootK.mul(5).add(rootKLast);
          uint256 liquidity = numerator / denominator;

          if (liquidity > 0) _mint(feeTo, liquidity);
        }
      }
    } else if (_kLast != 0) {
      kLast = 0;
    }
  }

  // =====================================================
  //    Externally Accessible Functions
  // =====================================================

  // this function should be called from a contract which performs important safety checks
  function mint(address to) external lock returns (uint256 liquidity) {
    (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings

    // Get the current balances and see how much was added of each token type.
    uint256 balance0 = IERC20(token0).balanceOf(address(this));
    uint256 balance1 = IERC20(token1).balanceOf(address(this));
    uint256 amount0 = balance0.sub(_reserve0);
    uint256 amount1 = balance1.sub(_reserve1);

    bool feeOn = _mintFee(_reserve0, _reserve1);

    uint256 _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee

    if (_totalSupply == 0) {
      liquidity = Math.sqrt(amount0.mul(amount1)).sub(MINIMUM_LIQUIDITY);
      _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
    } else {
      // With every subsequent deposit we already know the exchange rate between the two assets,
      // and we expect liquidity providers to provide equal value in both.
      // If they don't, we give them liquidity tokens based on the lesser value they provided as a punishment.

      // Whether it is the initial deposit or a subsequent one,
      // the number of liquidity tokens we provide
      // is equal to the square root of the change in reserve0*reserve1 and the value of the liquidity token doesn't change
      // (unless we get a deposit that doesn't have equal values of both types, in which case the "fine" gets distributed).
      liquidity = Math.min(
        amount0.mul(_totalSupply) / _reserve0,
        amount1.mul(_totalSupply) / _reserve1
      );
    }
    require(liquidity > 0, "UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED");

    _mint(to, liquidity);

    _update(balance0, balance1, _reserve0, _reserve1);

    if (feeOn) kLast = uint256(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date

    emit Mint(msg.sender, amount0, amount1);
  }

  // This function is called when liquidity is withdrawn and the appropriate liquidity tokens need to be burned.
  // Is should also be called from a periphery account.

  // This function should be called from a contract which performs important safety checks
  function burn(address to)
    external
    lock
    returns (uint256 amount0, uint256 amount1)
  {
    (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings

    address _token0 = token0; // gas savings
    address _token1 = token1; // gas savings

    uint256 balance0 = IERC20(_token0).balanceOf(address(this));
    uint256 balance1 = IERC20(_token1).balanceOf(address(this));

    uint256 liquidity = balanceOf[address(this)];

    bool feeOn = _mintFee(_reserve0, _reserve1);

    uint256 _totalSupply = totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee

    amount0 = liquidity.mul(balance0) / _totalSupply; // using balances ensures pro-rata distribution
    amount1 = liquidity.mul(balance1) / _totalSupply; // using balances ensures pro-rata distribution

    require(
      amount0 > 0 && amount1 > 0,
      "UniswapV2: INSUFFICIENT_LIQUIDITY_BURNED"
    );

    _burn(address(this), liquidity);

    _safeTransfer(_token0, to, amount0);
    _safeTransfer(_token1, to, amount1);

    balance0 = IERC20(_token0).balanceOf(address(this));
    balance1 = IERC20(_token1).balanceOf(address(this));

    _update(balance0, balance1, _reserve0, _reserve1);

    if (feeOn) kLast = uint256(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date

    emit Burn(msg.sender, amount0, amount1, to);
  }

  // This function is also supposed to be called from a periphery contract.
  // this low-level function should be called from a contract which performs important safety checks
  function swap(
    uint256 amount0Out,
    uint256 amount1Out,
    address to,
    bytes calldata data
  ) external lock {
    require(
      amount0Out > 0 || amount1Out > 0,
      "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT"
    );

    (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings

    require(
      amount0Out < _reserve0 && amount1Out < _reserve1,
      "UniswapV2: INSUFFICIENT_LIQUIDITY"
    );

    uint256 balance0;
    uint256 balance1;
    {
      // scope for _token{0,1}, avoids stack too deep errors
      address _token0 = token0;
      address _token1 = token1;

      require(to != _token0 && to != _token1, "UniswapV2: INVALID_TO");

      if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
      if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens

      if (data.length > 0) {
        IUniswapV2Callee(to).uniswapV2Call(
          msg.sender,
          amount0Out,
          amount1Out,
          data
        );
      }

      balance0 = IERC20(_token0).balanceOf(address(this));
      balance1 = IERC20(_token1).balanceOf(address(this));
    }

    uint256 amount0In = balance0 > _reserve0 - amount0Out
      ? balance0 - (_reserve0 - amount0Out)
      : 0;
    uint256 amount1In = balance1 > _reserve1 - amount1Out
      ? balance1 - (_reserve1 - amount1Out)
      : 0;

    require(
      amount0In > 0 || amount1In > 0,
      "UniswapV2: INSUFFICIENT_INPUT_AMOUNT"
    );

    {
      // scope for reserve{0,1} Adjusted, avoids stack too deep errors
      uint256 balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
      uint256 balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));

      require(
        balance0Adjusted.mul(balance1Adjusted) >=
          uint256(_reserve0).mul(_reserve1).mul(1000**2),
        "UniswapV2: K"
      );
    }

    _update(balance0, balance1, _reserve0, _reserve1);

    emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
  }

  // It is possible for the real balances to get out of sync with the reserves that the pair exchange thinks it has.
  // There is no way to withdraw tokens without the contract's consent, but deposits are a different matter.
  // An account can transfer tokens to the exchange without calling either mint or swap.

  // In that case there are two solutions:

  // 1. sync, update the reserves to the current balances

  // 2. skim, withdraw the extra amount.
  //    Note that any account is allowed to call skim because we don't know who deposited the tokens.
  //    This information is emitted in an event, but events are not accessible from the blockchain.

  // force reserves to match balances
  function sync() external lock {
    _update(
      IERC20(token0).balanceOf(address(this)),
      IERC20(token1).balanceOf(address(this)),
      reserve0,
      reserve1
    );
  }

  // force balances to match reserves
  function skim(address to) external lock {
    address _token0 = token0; // gas savings
    address _token1 = token1; // gas savings
    _safeTransfer(
      _token0,
      to,
      IERC20(_token0).balanceOf(address(this)).sub(reserve0)
    );
    _safeTransfer(
      _token1,
      to,
      IERC20(_token1).balanceOf(address(this)).sub(reserve1)
    );
  }
}

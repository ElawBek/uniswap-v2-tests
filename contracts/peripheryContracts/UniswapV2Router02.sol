// SPDX-License-Identifier: MIT

pragma solidity =0.6.6;

import '../coreContracts/interfaces/IUniswapV2Factory.sol';
import './helpers/TransferHelper.sol';

import './interfaces/IUniswapV2Router02.sol';
import './libraries/UniswapV2Library.sol';
import './libraries/SafeMath.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWETH.sol';

contract UniswapV2Router02 is IUniswapV2Router02 {
	// =====================================================
	//    Labraries
	// =====================================================

	using SafeMath for uint256;

	// =====================================================
	//    Variables
	// =====================================================

	// The router needs to know what factory to use, and for transactions that require WETH what WETH contract to use.
	// They can only be set in the constructor.
	address public immutable override factory;
	address public immutable override WETH;

	// =====================================================
	//    Modifiers
	// =====================================================

	// This modifier makes sure that time limited transactions ("do X before time Y if you can") don't happen after their time limit.
	modifier ensure(uint256 deadline) {
		require(deadline >= block.timestamp, 'UniswapV2Router: EXPIRED');
		_;
	}

	// =====================================================
	//    Setup Functions
	// =====================================================

	constructor(address _factory, address _WETH) public {
		factory = _factory;
		WETH = _WETH;
	}

	// =====================================================
	//    Common Functions
	// =====================================================

	// This function is called when we redeem tokens from the WETH contract back into ETH.
	// Only the WETH contract we use is authorized to do that
	receive() external payable {
		assert(msg.sender == WETH); // only accept ETH via fallback from the WETH contract
	}

	// These functions add tokens to the pair exchange, which increases the liquidity pool.

	// **** ADD LIQUIDITY ****
	//This function is used to calculate the amount of A and B tokens that should be deposited into the pair exchange.
	function _addLiquidity(
		address tokenA,
		address tokenB,
		uint256 amountADesired,
		uint256 amountBDesired,
		uint256 amountAMin,
		uint256 amountBMin
	) internal virtual returns (uint256 amountA, uint256 amountB) {
		// create the pair if it doesn't exist yet
		if (IUniswapV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
			IUniswapV2Factory(factory).createPair(tokenA, tokenB);
		}

		(uint256 reserveA, uint256 reserveB) = UniswapV2Library.getReserves(factory, tokenA, tokenB);

		// If the current reserves are empty then this is a new pair exchange.
		if (reserveA == 0 && reserveB == 0) {
			(amountA, amountB) = (amountADesired, amountBDesired);
		} else {
			uint256 amountBOptimal = UniswapV2Library.quote(amountADesired, reserveA, reserveB);

			// If amountBOptimal is smaller than the amount the liquidity provider wants to deposit
			// it means that token B is more valuable currently than the liquidity depositor thinks, so a smaller amount is required.
			if (amountBOptimal <= amountBDesired) {
				require(amountBOptimal >= amountBMin, 'UniswapV2Router: INSUFFICIENT_B_AMOUNT');

				(amountA, amountB) = (amountADesired, amountBOptimal);
			} else {
				// If the optimal B amount is more than the desired B amount
				// it means B tokens are less valuable currently than the liquidity depositor thinks, so a higher amount is required.

				uint256 amountAOptimal = UniswapV2Library.quote(amountBDesired, reserveB, reserveA);
				assert(amountAOptimal <= amountADesired);

				require(amountAOptimal >= amountAMin, 'UniswapV2Router: INSUFFICIENT_A_AMOUNT');

				(amountA, amountB) = (amountAOptimal, amountBDesired);
			}
		}
	}

	// This function can be called by a transaction to deposit liquidity.
	// Most parameters are the same as in _addLiquidity above, with two exceptions:

	// to is the address that gets the new liquidity tokens minted to show the liquidity provider's portion of the pool
	// deadline is a time limit on the transaction
	function addLiquidity(
		address tokenA,
		address tokenB,
		uint256 amountADesired,
		uint256 amountBDesired,
		uint256 amountAMin,
		uint256 amountBMin,
		address to,
		uint256 deadline
	)
		external
		virtual
		override
		ensure(deadline)
		returns (
			uint256 amountA,
			uint256 amountB,
			uint256 liquidity
		)
	{
		// We calculate the amounts to actually deposit and then find the address of the liquidity pool.
		(amountA, amountB) = _addLiquidity(
			tokenA,
			tokenB,
			amountADesired,
			amountBDesired,
			amountAMin,
			amountBMin
		);

		// To save gas we don't do this by asking the factory, but using the library function pairFor
		address pair = UniswapV2Library.pairFor(factory, tokenA, tokenB);

		// Transfer the correct amounts of tokens from the user into the pair exchange.
		TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
		TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);

		liquidity = IUniswapV2Pair(pair).mint(to);
	}

	// When a liquidity provider wants to provide liquidity to a Token/ETH pair exchange, there are a few differences.
	// The contract handles wrapping the ETH for the liquidity provider.
	// There is no need to specify how many ETH the user wants to deposit, because the user just sends them with the transaction
	function addLiquidityETH(
		address token,
		uint256 amountTokenDesired,
		uint256 amountTokenMin,
		uint256 amountETHMin,
		address to,
		uint256 deadline
	)
		external
		payable
		virtual
		override
		ensure(deadline)
		returns (
			uint256 amountToken,
			uint256 amountETH,
			uint256 liquidity
		)
	{
		(amountToken, amountETH) = _addLiquidity(
			token,
			WETH,
			amountTokenDesired,
			msg.value,
			amountTokenMin,
			amountETHMin
		);

		address pair = UniswapV2Library.pairFor(factory, token, WETH);

		TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
		IWETH(WETH).deposit{ value: amountETH }();

		assert(IWETH(WETH).transfer(pair, amountETH));

		liquidity = IUniswapV2Pair(pair).mint(to);

		// refund dust eth, if any
		if (msg.value > amountETH) TransferHelper.safeTransferETH(msg.sender, msg.value - amountETH);
	}

	// **** REMOVE LIQUIDITY ****
	// These functions will remove liquidity and pay back the liquidity provider.
	function removeLiquidity(
		address tokenA,
		address tokenB,
		uint256 liquidity,
		uint256 amountAMin,
		uint256 amountBMin,
		address to,
		uint256 deadline
	) public virtual override ensure(deadline) returns (uint256 amountA, uint256 amountB) {
		address pair = UniswapV2Library.pairFor(factory, tokenA, tokenB);

		IUniswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair

		// The core contract's burn function handles paying the user back the tokens.
		(uint256 amount0, uint256 amount1) = IUniswapV2Pair(pair).burn(to);

		(address token0, ) = UniswapV2Library.sortTokens(tokenA, tokenB);

		(amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);

		// It is OK to do the transfer first and then verify it is legitimate, because if it isn't we'll revert out of all the state changes.
		require(amountA >= amountAMin, 'UniswapV2Router: INSUFFICIENT_A_AMOUNT');
		require(amountB >= amountBMin, 'UniswapV2Router: INSUFFICIENT_B_AMOUNT');
	}

	// Remove liquidity for ETH is almost the same, except that we receive the WETH tokens and then redeem them for ETH to give back to the liquidity provider.
	function removeLiquidityETH(
		address token,
		uint256 liquidity,
		uint256 amountTokenMin,
		uint256 amountETHMin,
		address to,
		uint256 deadline
	) public virtual override ensure(deadline) returns (uint256 amountToken, uint256 amountETH) {
		(amountToken, amountETH) = removeLiquidity(
			token,
			WETH,
			liquidity,
			amountTokenMin,
			amountETHMin,
			address(this),
			deadline
		);

		TransferHelper.safeTransfer(token, to, amountToken);
		IWETH(WETH).withdraw(amountETH);
		TransferHelper.safeTransferETH(to, amountETH);
	}

	// **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
	// This function can be used for tokens that have transfer or storage fees.
	// When a token has such fees we cannot rely on the removeLiquidity function to tell us how much of the token we get back,
	// so we need to withdraw first and then get the balance.
	function removeLiquidityETHSupportingFeeOnTransferTokens(
		address token,
		uint256 liquidity,
		uint256 amountTokenMin,
		uint256 amountETHMin,
		address to,
		uint256 deadline
	) public virtual override ensure(deadline) returns (uint256 amountETH) {
		(, amountETH) = removeLiquidity(
			token,
			WETH,
			liquidity,
			amountTokenMin,
			amountETHMin,
			address(this),
			deadline
		);

		TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
		IWETH(WETH).withdraw(amountETH);
		TransferHelper.safeTransferETH(to, amountETH);
	}

	function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
		address token,
		uint256 liquidity,
		uint256 amountTokenMin,
		uint256 amountETHMin,
		address to,
		uint256 deadline,
		bool approveMax,
		uint8 v,
		bytes32 r,
		bytes32 s
	) external virtual override returns (uint256 amountETH) {
		address pair = UniswapV2Library.pairFor(factory, token, WETH);
		uint256 value = approveMax ? uint256(-1) : liquidity;
		IUniswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
		amountETH = removeLiquidityETHSupportingFeeOnTransferTokens(
			token,
			liquidity,
			amountTokenMin,
			amountETHMin,
			to,
			deadline
		);
	}

	// **** SWAP ****
	// requires the initial amount to have already been sent to the first pair
	function _swap(
		uint256[] memory amounts,
		address[] memory path,
		address _to
	) internal virtual {
		for (uint256 i; i < path.length - 1; i++) {
			// Get the pair we are currently handling, sort it (for use with the pair) and get the expected output amount.
			(address input, address output) = (path[i], path[i + 1]);

			(address token0, ) = UniswapV2Library.sortTokens(input, output);

			uint256 amountOut = amounts[i + 1];

			// Get the expected out amounts, sorted the way the pair exchange expects them to be.
			(uint256 amount0Out, uint256 amount1Out) = input == token0
				? (uint256(0), amountOut)
				: (amountOut, uint256(0));

			// Is this the last exchange?
			// If so, send the tokens received for the trade to the destination.
			// If not, send it to the next pair exchange.
			address to = i < path.length - 2
				? UniswapV2Library.pairFor(factory, output, path[i + 2])
				: _to;

			// Actually call the pair exchange to swap the tokens.
			// We don't need a callback to be told about the exchange, so we don't send any bytes in that field.
			IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output)).swap(
				amount0Out,
				amount1Out,
				to,
				new bytes(0)
			);
		}
	}

	// This function is used directly by traders to swap one token for another.
	function swapExactTokensForTokens(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
		// Calculate the amount to be purchased in each swap.
		amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);

		// If the result is less than the minimum the trader is willing to accept, revert out of the transaction.
		require(
			amounts[amounts.length - 1] >= amountOutMin,
			'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
		);

		// Finally, transfer the initial ERC-20 token to the account for the first pair exchange and call _swap.
		// This is all happening in the same transaction, so the pair exchange knows that any unexpected tokens are part of this transfer.
		TransferHelper.safeTransferFrom(
			path[0],
			msg.sender,
			UniswapV2Library.pairFor(factory, path[0], path[1]),
			amounts[0]
		);

		_swap(amounts, path, to);
	}

	// These four variants all involve trading between ETH and tokens.
	// The only difference is that we either receive ETH from the trader and use it to mint WETH,
	// or we receive WETH from the last exchange in the path and burn it, sending the trader back the resulting ETH.
	function swapExactETHForTokens(
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external payable virtual override ensure(deadline) returns (uint256[] memory amounts) {
		require(path[0] == WETH, 'UniswapV2Router: INVALID_PATH');

		amounts = UniswapV2Library.getAmountsOut(factory, msg.value, path);

		require(
			amounts[amounts.length - 1] >= amountOutMin,
			'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
		);

		IWETH(WETH).deposit{ value: amounts[0] }();

		assert(IWETH(WETH).transfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]));

		_swap(amounts, path, to);
	}

	function swapTokensForExactETH(
		uint256 amountOut,
		uint256 amountInMax,
		address[] calldata path,
		address to,
		uint256 deadline
	) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
		require(path[path.length - 1] == WETH, 'UniswapV2Router: INVALID_PATH');

		amounts = UniswapV2Library.getAmountsIn(factory, amountOut, path);

		require(amounts[0] <= amountInMax, 'UniswapV2Router: EXCESSIVE_INPUT_AMOUNT');

		TransferHelper.safeTransferFrom(
			path[0],
			msg.sender,
			UniswapV2Library.pairFor(factory, path[0], path[1]),
			amounts[0]
		);

		_swap(amounts, path, address(this));
		IWETH(WETH).withdraw(amounts[amounts.length - 1]);
		TransferHelper.safeTransferETH(to, amounts[amounts.length - 1]);
	}

	function swapExactTokensForETH(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
		require(path[path.length - 1] == WETH, 'UniswapV2Router: INVALID_PATH');

		amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);

		require(
			amounts[amounts.length - 1] >= amountOutMin,
			'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
		);

		TransferHelper.safeTransferFrom(
			path[0],
			msg.sender,
			UniswapV2Library.pairFor(factory, path[0], path[1]),
			amounts[0]
		);

		_swap(amounts, path, address(this));
		IWETH(WETH).withdraw(amounts[amounts.length - 1]);
		TransferHelper.safeTransferETH(to, amounts[amounts.length - 1]);
	}

	function swapETHForExactTokens(
		uint256 amountOut,
		address[] calldata path,
		address to,
		uint256 deadline
	) external payable virtual override ensure(deadline) returns (uint256[] memory amounts) {
		require(path[0] == WETH, 'UniswapV2Router: INVALID_PATH');

		amounts = UniswapV2Library.getAmountsIn(factory, amountOut, path);

		require(amounts[0] <= msg.value, 'UniswapV2Router: EXCESSIVE_INPUT_AMOUNT');

		IWETH(WETH).deposit{ value: amounts[0] }();

		assert(IWETH(WETH).transfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amounts[0]));

		_swap(amounts, path, to);

		// refund dust eth, if any
		if (msg.value > amounts[0]) TransferHelper.safeTransferETH(msg.sender, msg.value - amounts[0]);
	}

	// **** SWAP (supporting fee-on-transfer tokens) ****
	// requires the initial amount to have already been sent to the first pair
	function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal virtual {
		for (uint256 i; i < path.length - 1; i++) {
			(address input, address output) = (path[i], path[i + 1]);
			(address token0, ) = UniswapV2Library.sortTokens(input, output);

			IUniswapV2Pair pair = IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output));

			uint256 amountInput;
			uint256 amountOutput;
			{
				// scope to avoid stack too deep errors
				(uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
				(uint256 reserveInput, uint256 reserveOutput) = input == token0
					? (reserve0, reserve1)
					: (reserve1, reserve0);

				amountInput = IERC20(input).balanceOf(address(pair)).sub(reserveInput);
				amountOutput = UniswapV2Library.getAmountOut(amountInput, reserveInput, reserveOutput);
			}
			(uint256 amount0Out, uint256 amount1Out) = input == token0
				? (uint256(0), amountOutput)
				: (amountOutput, uint256(0));

			address to = i < path.length - 2
				? UniswapV2Library.pairFor(factory, output, path[i + 2])
				: _to;

			pair.swap(amount0Out, amount1Out, to, new bytes(0));
		}
	}

	function swapExactTokensForTokensSupportingFeeOnTransferTokens(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external virtual override ensure(deadline) {
		TransferHelper.safeTransferFrom(
			path[0],
			msg.sender,
			UniswapV2Library.pairFor(factory, path[0], path[1]),
			amountIn
		);

		uint256 balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);

		_swapSupportingFeeOnTransferTokens(path, to);

		require(
			IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
			'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
		);
	}

	function swapExactETHForTokensSupportingFeeOnTransferTokens(
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external payable virtual override ensure(deadline) {
		require(path[0] == WETH, 'UniswapV2Router: INVALID_PATH');

		uint256 amountIn = msg.value;

		IWETH(WETH).deposit{ value: amountIn }();

		assert(IWETH(WETH).transfer(UniswapV2Library.pairFor(factory, path[0], path[1]), amountIn));

		uint256 balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);

		_swapSupportingFeeOnTransferTokens(path, to);

		require(
			IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
			'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
		);
	}

	function swapExactTokensForETHSupportingFeeOnTransferTokens(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external virtual override ensure(deadline) {
		require(path[path.length - 1] == WETH, 'UniswapV2Router: INVALID_PATH');

		TransferHelper.safeTransferFrom(
			path[0],
			msg.sender,
			UniswapV2Library.pairFor(factory, path[0], path[1]),
			amountIn
		);

		_swapSupportingFeeOnTransferTokens(path, address(this));

		uint256 amountOut = IERC20(WETH).balanceOf(address(this));

		require(amountOut >= amountOutMin, 'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');

		IWETH(WETH).withdraw(amountOut);
		TransferHelper.safeTransferETH(to, amountOut);
	}

	// **** LIBRARY FUNCTIONS ****
	function quote(
		uint256 amountA,
		uint256 reserveA,
		uint256 reserveB
	) public pure virtual override returns (uint256 amountB) {
		return UniswapV2Library.quote(amountA, reserveA, reserveB);
	}

	function getAmountOut(
		uint256 amountIn,
		uint256 reserveIn,
		uint256 reserveOut
	) public pure virtual override returns (uint256 amountOut) {
		return UniswapV2Library.getAmountOut(amountIn, reserveIn, reserveOut);
	}

	function getAmountIn(
		uint256 amountOut,
		uint256 reserveIn,
		uint256 reserveOut
	) public pure virtual override returns (uint256 amountIn) {
		return UniswapV2Library.getAmountIn(amountOut, reserveIn, reserveOut);
	}

	function getAmountsOut(uint256 amountIn, address[] memory path)
		public
		view
		virtual
		override
		returns (uint256[] memory amounts)
	{
		return UniswapV2Library.getAmountsOut(factory, amountIn, path);
	}

	function getAmountsIn(uint256 amountOut, address[] memory path)
		public
		view
		virtual
		override
		returns (uint256[] memory amounts)
	{
		return UniswapV2Library.getAmountsIn(factory, amountOut, path);
	}
}

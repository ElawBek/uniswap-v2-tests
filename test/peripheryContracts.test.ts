import { expect } from 'chai'
import { ethers } from 'hardhat'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

import { signERC2612Permit } from 'eth-permit'

const timestamp = ethers.BigNumber.from(1852640309)

import {
	WETH9,
	WETH9__factory,
	Token,
	Token__factory,
	UniswapV2Pair,
	UniswapV2Pair__factory,
	UniswapV2Factory,
	UniswapV2Factory__factory,
	UniswapV2Router02,
	UniswapV2Router02__factory,
} from '../typechain-types'

describe('APP', () => {
	let owner: SignerWithAddress
	let userOne: SignerWithAddress
	let userTwo: SignerWithAddress

	let WETH: WETH9

	let TokenOne: Token
	let TokenTwo: Token
	let TokenThree: Token

	let Factory: UniswapV2Factory
	let Router: UniswapV2Router02
	let PairERCtoERC: UniswapV2Pair
	let PairERCtoWETH: UniswapV2Pair

	beforeEach(async () => {
		;[owner, userOne, userTwo] = await ethers.getSigners()

		// Deploy WETH contract
		WETH = await new WETH9__factory(owner).deploy()

		// Deploy tokens for test
		TokenOne = await new Token__factory(owner).deploy('tokenOne', 'TK1')
		TokenTwo = await new Token__factory(owner).deploy('tokenTwo', 'TK2')
		TokenThree = await new Token__factory(owner).deploy('tokenThree', 'TK3')

		// Deploy Factory
		Factory = await new UniswapV2Factory__factory(owner).deploy(owner.address)

		// Deploy Router
		Router = await new UniswapV2Router02__factory(owner).deploy(Factory.address, WETH.address)
	})

	it('Checking variables', async () => {
		expect(await Router.factory()).to.be.eq(Factory.address)
		expect(await Router.WETH()).to.be.eq(WETH.address)
	})

	describe('Add liquidity', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('1500'))
			await TokenTwo.mint(userOne.address, parseEther('1000'))

			await TokenOne.connect(userOne).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenOne.mint(userTwo.address, parseEther('50'))
			await TokenTwo.mint(userTwo.address, parseEther('200'))

			await TokenOne.connect(userTwo).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userTwo).approve(Router.address, constants.MaxUint256)
		})

		it('Add liquidity with the creation pair', async () => {
			// create TokenOne - TokenTwo pair
			await expect(
				Router.connect(userOne).addLiquidity(
					TokenOne.address, // tokenA
					TokenTwo.address, // tokenB
					parseEther('5'), // amountADesired
					parseEther('20'), // amountBDesired
					parseEther('1'), // amountAMin
					parseEther('1'), // amountBMin
					userOne.address, // to
					timestamp // deadline
				)
			).to.emit(Factory, 'PairCreated')

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// Check LP-Balance for UserOne
			// sqrt(5e18 * 20e18) - 1000 =
			// 9999999999999999000 or 9.999999999999999000 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoERC.connect(userOne).balanceOf(userOne.address)).to.be.eq(
				parseEther('9.999999999999999000')
			)

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			expect(reserveTKN2).to.be.eq(parseEther('20'))
			expect(reserveTKN1).to.be.eq(parseEther('5'))
		})

		it('Add liquidity to the existing pair', async () => {
			// create TokenOne - TokenTwo pair
			await Router.connect(userOne).addLiquidity(
				TokenOne.address, // tokenA
				TokenTwo.address, // tokenB
				parseEther('5'), // amountADesired
				parseEther('20'), // amountBDesired
				parseEther('1'), // amountAMin
				parseEther('1'), // amountBMin
				userOne.address, // to
				timestamp // deadline
			)

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// add liquidity to TokenOne - TokenTwo pair
			await expect(
				() =>
					Router.connect(userTwo).addLiquidity(
						TokenTwo.address, // tokenA
						TokenOne.address, // tokenB
						parseEther('200'), // amountADesired
						parseEther('50'), // amountBDesired
						constants.Zero, // amountAMin
						constants.Zero, // amountBMin
						userTwo.address, // to
						timestamp // deadline
					)
				// sqrt(200e18 * 50e18) = 100e18
			).to.changeTokenBalance(PairERCtoERC.connect(userTwo), userTwo, parseEther('100'))

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			expect(reserveTKN2).to.be.eq(parseEther('220'))
			expect(reserveTKN1).to.be.eq(parseEther('55'))

			// Adding liquidity with an unequal coefficient
			await expect(
				() =>
					Router.connect(userOne).addLiquidity(
						TokenTwo.address, // tokenA
						TokenOne.address, // tokenB
						parseEther('60'), // amountADesired
						parseEther('50'), // amountBDesired
						constants.Zero, // amountAMin
						constants.Zero, // amountBMin
						userOne.address, // to
						timestamp // deadline
					)
				// The smallest of the formula is selected: amount * totalSupply / reserve
				// 60e18 * 110e18 / 220e18 = 30000000000000000000 or 30.000000000000000000 LP
				// 50e18 * 110e18 / 55e18 = 100000000000000000000 or 100.000000000000000000 LP
			).to.changeTokenBalance(PairERCtoERC.connect(userOne), userOne, parseEther('30'))
		})

		it('Add liquidity with ETH', async () => {
			// create TokenOne - WETH pair
			await expect(
				await Router.connect(userOne).addLiquidityETH(
					TokenOne.address, // token,
					parseEther('1000'), // amountTokenDesired,
					constants.Zero, // amountTokenMin,
					constants.Zero, // amountETHMin,
					userOne.address, // to,
					timestamp, // deadline
					{ value: parseEther('2') }
				)
			).to.changeEtherBalance(userOne, parseEther('-2'))

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, WETH.address)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPair)

			// sqrt(1000e18 * 2e18) - 1000 =
			// 44721359549995792928 or 44.721359549995792928 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoWETH.connect(userOne).balanceOf(userOne.address)).to.be.eq(
				parseEther('44.721359549995792928')
			)

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairERCtoWETH.address)
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoWETH.address)

			expect(reserveTKN1).to.be.eq(parseEther('1000'))
			expect(reserveWETH).to.be.eq(parseEther('2'))
		})
	})

	describe('Remove liquidity', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('1500'))
			await TokenTwo.mint(userOne.address, parseEther('1000'))

			await TokenOne.connect(userOne).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenOne.mint(userTwo.address, parseEther('50'))
			await TokenTwo.mint(userTwo.address, parseEther('200'))

			await TokenOne.connect(userTwo).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userTwo).approve(Router.address, constants.MaxUint256)

			// create TokenOne - TokenTwo pair
			await Router.connect(userOne).addLiquidity(
				TokenOne.address, // tokenA,
				TokenTwo.address, // tokenB,
				parseEther('5'), // amountADesired,
				parseEther('20'), // amountBDesired,
				parseEther('1'), // amountAMin,
				parseEther('1'), // amountBMin,
				userOne.address, // to,
				timestamp // deadline
			)

			// add liquidity to TokenOne - TokenTwo pair
			await Router.connect(userTwo).addLiquidity(
				TokenTwo.address, // tokenA,
				TokenOne.address, // tokenB,
				parseEther('200'), // amountADesired,
				parseEther('50'), // amountBDesired,
				constants.Zero, // amountAMin,
				constants.Zero, // amountBMin,
				userTwo.address, // to,
				timestamp // deadline
			)

			// create TokenOne - WETH pair
			await Router.connect(userOne).addLiquidityETH(
				TokenOne.address, // token,
				parseEther('1000'), // amountTokenDesired,
				constants.Zero, // amountTokenMin,
				constants.Zero, // amountETHMin,
				userOne.address, // to,
				timestamp, // deadline
				{ value: parseEther('2') }
			)

			// Make the pair's contracts callable
			const createdPairTokens = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairTokens)

			const createdPairWithETH = await Factory.getPair(TokenOne.address, WETH.address)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPairWithETH)
		})

		it('Remove tokens Liquidity', async () => {
			await PairERCtoERC.connect(userOne).approve(Router.address, constants.MaxUint256)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 5e18 * 55e18 / 110e18 = 2.5 TKN1
			// For TokenTwo: 5e18 * 220e18 / 110e18 = 10 TKN2
			await expect(() =>
				Router.connect(userOne).removeLiquidity(
					TokenOne.address, // tokenA,
					TokenTwo.address, // tokenB,
					parseEther('5'), // liquidity,
					parseEther('2.3'), // amountAMin,
					parseEther('9.5'), // amountBMin,
					userOne.address, // to,
					timestamp // deadline
				)
			)
				.to.emit(PairERCtoERC.connect(userOne), 'Burn')
				.to.changeTokenBalance(PairERCtoERC.connect(userOne), userOne, parseEther('-5'))

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			// 210 - 10
			expect(reserveTKN2).to.be.eq(parseEther('210'))
			// 55 - 2.5
			expect(reserveTKN1).to.be.eq(parseEther('52.5'))
		})

		it('Remove liquidity with ETH', async () => {
			await PairERCtoWETH.connect(userOne).approve(Router.address, constants.MaxUint256)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 22360679774997896964 * 1000e18 / 44721359549995793928 = 500 TKN1
			// For TokenTwo: 22360679774997896964 * 2e18 / 44721359549995793928 = 1 ETH
			await expect(() =>
				Router.connect(userOne).removeLiquidityETH(
					TokenOne.address, // token,
					parseEther('22.360679774997896964'), // liquidity,
					parseEther('200'), // amountTokenMin,
					parseEther('0.6'), // amountETHMin,
					userOne.address, // to,
					timestamp // deadline
				)
			)
				.to.emit(PairERCtoWETH.connect(userOne), 'Sync')
				.to.changeTokenBalance(
					PairERCtoWETH.connect(userOne),
					userOne,
					parseEther('-22.360679774997896964')
				)

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairERCtoWETH.address)
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoWETH.address)

			// 1000 - 500
			expect(reserveTKN1).to.be.eq(parseEther('500'))
			// 2 - 1
			expect(reserveWETH).to.be.eq(parseEther('1'))
		})

		it('Remove tokens liquidity with permit', async () => {
			const result = await signERC2612Permit(
				userTwo,
				PairERCtoERC.address,
				userTwo.address,
				Router.address,
				'86000000000000000000'
			)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 86e18 * 55e18 / 110e18 = 43 TKN1
			// For TokenTwo: 86e18 * 220e18 / 110e18 = 172 TKN2
			await expect(() =>
				Router.connect(userTwo).removeLiquidityWithPermit(
					TokenOne.address, // tokenA,
					TokenTwo.address, // tokenB,
					parseEther('86'), // liquidity,
					constants.Zero, // amountAMin,
					constants.Zero, // amountBMin,
					userTwo.address, // to,
					result.deadline, // deadline,
					false, // approveMax,
					result.v, // v,
					result.r, // r,
					result.s // s
				)
			).to.changeTokenBalance(PairERCtoERC.connect(userTwo), userTwo, parseEther('-86'))

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			// 55 - 43
			expect(reserveTKN1).to.be.eq(parseEther('12'))
			// 220 - 172
			expect(reserveTKN2).to.be.eq(parseEther('48'))
		})

		it('Remove ETH and tokenOne liquidity with permit', async () => {
			const result = await signERC2612Permit(
				userOne,
				PairERCtoWETH.address,
				userOne.address,
				Router.address,
				'12000000000000000000'
			)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 12e18 * 1000e18 / 44721359549995793928 = 268.328157299974763570 TKN1
			// For TokenTwo: 12e18 * 2e18 / 44721359549995793928 = 0.536656314599949527 ETH
			await expect(() =>
				Router.connect(userOne).removeLiquidityETHWithPermit(
					TokenOne.address, // token,
					parseEther('12'), // liquidity,
					constants.Zero, // amountTokenMin,
					constants.Zero, // amountETHMin,
					userOne.address, // to,
					result.deadline, // deadline,
					false, // approveMax,
					result.v, // v,
					result.r, // r,
					result.s // s
				)
			).to.changeTokenBalance(PairERCtoWETH.connect(userOne), userOne, parseEther('-12'))

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairERCtoWETH.address)
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoWETH.address)

			// 1000 - 268.328157299974763570 = 731.671842700025236430
			expect(reserveTKN1).to.be.eq(parseEther('731.671842700025236430'))
			// 2 - 0.536656314599949527 = 1463343685400050473
			expect(reserveWETH).to.be.eq(parseEther('1.463343685400050473'))
		})
	})

	describe('Swap', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('2000'))
			await TokenTwo.mint(userOne.address, parseEther('2000'))

			await TokenOne.connect(userOne).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenOne.mint(userTwo.address, parseEther('2000'))
			await TokenTwo.mint(userTwo.address, parseEther('2000'))

			await TokenOne.connect(userTwo).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userTwo).approve(Router.address, constants.MaxUint256)

			// create TokenOne - TokenTwo pair
			await Router.connect(userOne).addLiquidity(
				TokenOne.address, // tokenA,
				TokenTwo.address, // tokenB,
				parseEther('5'), // amountADesired,
				parseEther('20'), // amountBDesired,
				parseEther('1'), // amountAMin,
				parseEther('1'), // amountBMin,
				userOne.address, // to,
				timestamp // deadline
			)

			// add liquidity to TokenOne - TokenTwo pair
			await Router.connect(userTwo).addLiquidity(
				TokenTwo.address, // tokenA,
				TokenOne.address, // tokenB,
				parseEther('200'), // amountADesired,
				parseEther('50'), // amountBDesired,
				constants.Zero, // amountAMin,
				constants.Zero, // amountBMin,
				userTwo.address, // to,
				timestamp // deadline
			)

			// create TokenOne - WETH pair
			await Router.connect(userOne).addLiquidityETH(
				TokenOne.address, // token,
				parseEther('1000'), // amountTokenDesired,
				constants.Zero, // amountTokenMin,
				constants.Zero, // amountETHMin,
				userOne.address, // to,
				timestamp, // deadline
				{ value: parseEther('2') }
			)

			// Make the pair's contracts callable
			const createdPairTokens = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairTokens)

			const createdPairWithETH = await Factory.getPair(TokenOne.address, WETH.address)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPairWithETH)
		})

		it('Swap exact TKN1 For TKN2', async () => {
			// userOne already gave approve TokenOne --> Router

			// (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
			// (40e18 * 997 * 220e18) / (55e18 * 1000 + 40e18 * 997) =
			// 8,7736e+42 / 9,488e+22 =
			// 92470489038785834738 or 92.470489038785834738 TKN2

			const amounts = await Router.getAmountsOut(parseEther('40'), [
				TokenOne.address,
				TokenTwo.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('40'))
			expect(amounts[1]).to.be.eq(parseEther('92.470489038785834738'))

			await expect(() =>
				Router.connect(userOne).swapExactTokensForTokens(
					parseEther('40'), // amountIn,
					parseEther('80'), // amountOutMin,
					[TokenOne.address, TokenTwo.address], // path,
					userOne.address, // to,
					timestamp // deadline
				)
			)
				.to.emit(PairERCtoERC.connect(userOne), 'Swap')
				.to.changeTokenBalance(
					TokenTwo,
					PairERCtoERC.connect(userOne),
					parseEther('-92.470489038785834738')
				)

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			// 220 - 92.470489038785834738
			expect(reserveTKN2).to.be.eq(parseEther('127.529510961214165262'))
			// 55 + 40
			expect(reserveTKN1).to.be.eq(parseEther('95'))
		})

		it('Swap TKN2 for exact TKN1', async () => {
			// userTwo already gave approve TokenTwo --> Router

			// ((reserveIn * amountOut * 1000) / (reserveOut - amountOut) * 997)) + 1
			// ((220e18 * 21e18 * 1000) / (55e18 - 21e18) * 997)) + 1 =
			// (4.62e+42 / 3.3898e+22) + 1 =
			// 136291226621039589357 or 136.291226621039589357 TKN2

			const amounts = await Router.getAmountsIn(parseEther('21'), [
				TokenTwo.address,
				TokenOne.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('136.291226621039589357'))
			expect(amounts[1]).to.be.eq(parseEther('21'))

			await expect(() =>
				Router.connect(userTwo).swapTokensForExactTokens(
					parseEther('21'), // amountOut,
					parseEther('150'), // amountInMax,
					[TokenTwo.address, TokenOne.address], // path,
					userTwo.address, // to,
					timestamp // deadline
				)
			).to.changeTokenBalance(
				TokenTwo,
				PairERCtoERC.connect(userTwo),
				parseEther('136.291226621039589357')
			)

			// Check pair's reserves
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoERC.address)
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC.address)

			// 220 + 136.291226621039589357
			expect(reserveTKN2).to.be.eq(parseEther('356.291226621039589357'))
			// 55 + 31
			expect(reserveTKN1).to.be.eq(parseEther('34'))
		})

		it('Swap exact ETH for TKN1', async () => {
			// (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
			// (0.2e18 * 997 * 1000e18) / (2e18 * 1000 + 0.2e18 * 997) =
			// 1.994e+41 / 2.1994e+21 =
			// 90661089388014913158 or 90.661089388014913158 TKN1

			const amounts = await Router.getAmountsOut(parseEther('0.2'), [
				WETH.address,
				TokenOne.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('0.2'))
			expect(amounts[1]).to.be.eq(parseEther('90.661089388014913158'))

			await Router.connect(userOne).swapExactETHForTokens(
				parseEther('85'), //  amountOutMin,
				[WETH.address, TokenOne.address], //  path,
				userOne.address, //  to,
				timestamp, //  deadline,
				{ value: parseEther('0.2') }
			)

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairERCtoWETH.address)
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoWETH.address)

			// 1000 - 90.661089388014913158
			expect(reserveTKN1).to.be.eq(parseEther('909.338910611985086842'))
			// 2 - 0.2
			expect(reserveWETH).to.be.eq(parseEther('2.2'))
		})

		it('Swap TKN2 for exact ETH', async () => {
			// userTwo already gave approve TokenTwo --> Router

			// path = [TokenTwo.address, TokenOne.address, WETH.address]

			// ETH <-- TKN1
			// ((reserveIn * amountOut * 1000) / (reserveOut - amountOut) * 997)) + 1
			// ((1000e18 * 0.01e18 * 1000) / (2e18 - 0.01e18) * 997)) + 1 =
			// (1.e+40 / 1.98403e+21) + 1 =
			// 5040246367242430811 or 5.040246367242430811 TKN1

			// TKN1 <-- TKN2
			// ((reserveIn * amountOut * 1000) / (reserveOut - amountOut) * 997)) + 1
			// ((220e18 * 5040246367242430811 * 1000) / (55e18 - 5040246367242430811) * 997)) + 1 =
			// (1,10885420079333477842e+42 / 49809874371859296481433) + 1 =
			// 22261734541129371930 or 22.261734541129371930 TKN2

			// amounts[] = [22.261734541129371930 TKN2, 5.040246367242430811 TKN1, 0.01 WETH]

			const amounts = await Router.getAmountsIn(parseEther('0.01'), [
				TokenTwo.address,
				TokenOne.address,
				WETH.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('22.261734541129371930'))
			expect(amounts[1]).to.be.eq(parseEther('5.040246367242430811'))
			expect(amounts[2]).to.be.eq(parseEther('0.01'))

			await expect(() =>
				Router.connect(userTwo).swapTokensForExactETH(
					parseEther('0.01'), // amountOut,
					parseEther('30'), // amountInMax,
					[TokenTwo.address, TokenOne.address, WETH.address], // path,
					userTwo.address, // to,
					timestamp // deadline
				)
			).to.changeTokenBalance(
				TokenTwo,
				PairERCtoERC.connect(userTwo),
				parseEther('22.261734541129371930')
			)
		})

		it('Swap exact TKN2 for ETH', async () => {
			// userOne already gave approve TokenTwo --> Router

			// path = [TokenTwo.address, TokenOne.address, WETH.address]

			// TKN2 --> TKN1
			// (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
			// (105e18 * 997 * 55e18) / (220e18 * 1000 + 105e18 * 997) =
			// 5.757675e+42 / 3.24685e+23 =
			// 17733110553305511495 or 17.733110553305511495 TKN1

			// TKN1 --> ETH
			// (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
			// (17733110553305511495 * 997 * 2e18) / (1000e18 * 1000 + 17733110553305511495 * 997) =
			// 3.535982244329118992103e+40 / 1017679911221645594960515 =
			// 34745524652092692 or 0.034745524652092692 ETH

			// amounts[] = [105 TKN2, 17.733110553305511495 TKN1, 0.034745524652092692 WETH]

			const amounts = await Router.getAmountsOut(parseEther('105'), [
				TokenTwo.address,
				TokenOne.address,
				WETH.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('105'))
			expect(amounts[1]).to.be.eq(parseEther('17.733110553305511495'))
			expect(amounts[2]).to.be.eq(parseEther('0.034745524652092692'))

			await expect(
				await Router.connect(userOne).swapExactTokensForETH(
					parseEther('105'), // amountIn,
					parseEther('0.03'), // amountOutMin,
					[TokenTwo.address, TokenOne.address, WETH.address], // path,
					userOne.address, // to,
					timestamp // deadline
				)
			).to.changeEtherBalance(userOne, parseEther('0.034745524652092692'))
		})

		it('Swap ETH for exact TKN1', async () => {
			// ((reserveIn * amountOut * 1000) / (reserveOut - amountOut) * 997)) + 1
			// ((2e18 * 123e18 * 1000) / (1000e18 - 123e18) * 997)) + 1 =
			// (2.46e+41 / 8.74369e+23) + 1 =
			// 281345747619140203 or 0.281345747619140203 TKN2

			const amounts = await Router.getAmountsIn(parseEther('123'), [WETH.address, TokenOne.address])

			expect(amounts[0]).to.be.eq(parseEther('0.281345747619140203'))
			expect(amounts[1]).to.be.eq(parseEther('123'))

			await Router.connect(userTwo).swapETHForExactTokens(
				parseEther('123'), // amountOut,
				[WETH.address, TokenOne.address], // path,
				userTwo.address, // to,
				timestamp, // deadline
				{ value: parseEther('0.4') }
			)

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairERCtoWETH.address)
			const reserveTKN1 = await TokenOne.balanceOf(PairERCtoWETH.address)

			// 1000 - 123
			expect(reserveTKN1).to.be.eq(parseEther('877'))
			// 2 + 0.281345747619140203
			expect(reserveWETH).to.be.eq(parseEther('2.281345747619140203'))
		})
	})

	// TODO remove liquidity after swap
	// TODO test remove and swap liquidity with supporting Fee TransferTokens
	// TODO add liquidity with token less 18 decimals
	// TODO test with feeTo == true
})

import { expect } from 'chai'
import { ethers } from 'hardhat'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, constants } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

import { signERC2612Permit } from 'eth-permit'

const timestamp = ethers.BigNumber.from(1852640309)

import {
	WETH9,
	WETH9__factory,
	Token,
	Token__factory,
	TokenWithFee,
	TokenWithFee__factory,
	TokenWith6Decimals,
	TokenWith6Decimals__factory,
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
	let tokenWithFee: TokenWithFee
	let tokenWith6Decimals: TokenWith6Decimals

	let Factory: UniswapV2Factory
	let Router: UniswapV2Router02

	let PairERCtoERC: UniswapV2Pair
	let PairERCtoWETH: UniswapV2Pair
	let PairERCtoERCfee: UniswapV2Pair
	let PairETHtoERCfee: UniswapV2Pair
	let PairERCtoERC6: UniswapV2Pair

	beforeEach(async () => {
		;[owner, userOne, userTwo] = await ethers.getSigners()

		// Deploy WETH contract
		WETH = await new WETH9__factory(owner).deploy()

		// Deploy tokens for test
		TokenOne = await new Token__factory(owner).deploy('tokenOne', 'TK1')
		TokenTwo = await new Token__factory(owner).deploy('tokenTwo', 'TK2')

		tokenWithFee = await new TokenWithFee__factory(owner).deploy('TokenWithFee', 'TWF')
		tokenWith6Decimals = await new TokenWith6Decimals__factory(owner).deploy(
			'TokenWith6Decimals',
			'TW6'
		)

		// Deploy Factory
		Factory = await new UniswapV2Factory__factory(owner).deploy(owner.address)

		// Deploy Router
		Router = await new UniswapV2Router02__factory(owner).deploy(Factory.address, WETH.address)
	})

	describe('Swap', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('2000'))
			await TokenOne.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenTwo.mint(userOne.address, parseEther('2000'))
			await TokenTwo.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenOne.mint(userTwo.address, parseEther('2000'))
			await TokenOne.connect(userTwo).approve(Router.address, constants.MaxUint256)

			await TokenTwo.mint(userTwo.address, parseEther('2000'))
			await TokenTwo.connect(userTwo).approve(Router.address, constants.MaxUint256)

			await tokenWithFee.mint(userOne.address, parseEther('2000'))
			await tokenWithFee.connect(userOne).approve(Router.address, constants.MaxUint256)

			const decimals = await tokenWith6Decimals.decimals()
			await tokenWith6Decimals.mint(userTwo.address, BigNumber.from(200 * 10 ** decimals))
			await tokenWith6Decimals.connect(userTwo).approve(Router.address, constants.MaxUint256)

			// create TokenOne - TokenTwo pair
			await Router.connect(userOne).addLiquidity(
				TokenOne.address, // tokenA,
				TokenTwo.address, // tokenB,
				parseEther('5'), // amountADesired,
				parseEther('20'), // amountBDesired,
				constants.Zero, // amountAMin,
				constants.Zero, // amountBMin,
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

			// create TokenWithFee - TokenTwo pair
			await Router.connect(userOne).addLiquidity(
				tokenWithFee.address, // tokenA,
				TokenTwo.address, // tokenB,
				parseEther('500'), // amountADesired,
				parseEther('100'), // amountBDesired,
				constants.Zero, // amountAMin,
				constants.Zero, // amountBMin,
				userOne.address, // to,
				timestamp // deadline
			)

			// create TokenWithFee - WETH pair
			await Router.connect(userOne).addLiquidityETH(
				tokenWithFee.address, // token,
				parseEther('500'), // amountTokenDesired,
				constants.Zero, // amountTokenMin,
				constants.Zero, // amountETHMin,
				userOne.address, // to,
				timestamp, // deadline
				{ value: parseEther('5') }
			)

			// Create TokenWith6Decimals - TokenTwo pair
			await Router.connect(userTwo).addLiquidity(
				TokenTwo.address, // tokenA
				tokenWith6Decimals.address, // tokenB
				parseEther('20'), // amountADesired
				BigNumber.from(200 * 10 ** decimals), // amountBDesired
				constants.Zero, // amountAMin
				constants.Zero, // amountBMin
				userTwo.address, // to
				timestamp // deadline
			)

			// Make the pair's contracts callable

			// TokenOne -- TokenTwo
			const createdPairTokens = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairTokens)

			// TokenOne -- WETH
			const createdPairWithETH = await Factory.getPair(TokenOne.address, WETH.address)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPairWithETH)

			// TokenWithFee -- WETH
			const createdPairEthAndTokenWithFee = await Factory.getPair(
				tokenWithFee.address,
				WETH.address
			)
			PairETHtoERCfee = new UniswapV2Pair__factory().attach(createdPairEthAndTokenWithFee)

			// TokenWithFee -- TokenTwo
			const createdPairTokenAndTokenWithFee = await Factory.getPair(
				tokenWithFee.address,
				TokenTwo.address
			)
			PairERCtoERCfee = new UniswapV2Pair__factory().attach(createdPairTokenAndTokenWithFee)

			// TokenTwo -- TokenWith6Decimals
			const createdPairTokenWith6 = await Factory.getPair(
				TokenTwo.address,
				tokenWith6Decimals.address
			)
			PairERCtoERC6 = new UniswapV2Pair__factory().attach(createdPairTokenWith6)
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

		it('Swap TKN2 for exact TW6', async () => {
			// userOne already gave approve TokenTwo --> Router

			// ((reserveIn * amountOut * 1000) / (reserveOut - amountOut) * 997)) + 1
			// ((20e18 * 34e6 * 1000) / (200e6 - 34e6) * 997)) + 1 =
			// (6.8e+29 / 1.65502e+11) + 1 =
			// 4108711677200275526 or 4.108711677200275526 TKN2

			const amounts = await Router.getAmountsIn(BigNumber.from(34 * 10 ** 6), [
				TokenTwo.address,
				tokenWith6Decimals.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('4.108711677200275526'))
			expect(amounts[1]).to.be.eq(BigNumber.from(34 * 10 ** 6))

			await expect(() =>
				Router.connect(userOne).swapTokensForExactTokens(
					BigNumber.from(34 * 10 ** 6), // amountOut,
					parseEther('5'), // amountInMax,
					[TokenTwo.address, tokenWith6Decimals.address], // path,
					userOne.address, // to,
					timestamp // deadline
				)
			).to.changeTokenBalance(
				TokenTwo,
				PairERCtoERC6.connect(userOne),
				parseEther('4.108711677200275526')
			)

			// Check pair's reserves
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC6.address)
			const reserveTW6 = await tokenWith6Decimals.balanceOf(PairERCtoERC6.address)

			// 20 + 4.108711677200275526
			expect(reserveTKN2).to.be.eq(parseEther('24.108711677200275526'))
			// 200 - 34
			expect(reserveTW6).to.be.eq(BigNumber.from('166000000'))
		})

		it('Swap exact TKN2 for TWF', async () => {
			// userOne already gave approve TokenWithFee --> Router

			// amountIn * 997 * reserveOut / reserveIn * 1000 + amountIn * 997
			// 67e18 * 997 * 498.5e18 / 100e18 * 1000 + 67e18 * 997 =
			// 3.32993015e+43 / 1.66799e+23 =
			// 199637296986192962787 or 199.637296986192962787 TWF
			// Just one translation of tokens from a couple to the user --> -0.3% fee
			// 199.637296986192962787 * 0.997 = 199.038385095234383898 TWF

			const amounts = await Router.getAmountsOut(parseEther('67'), [
				TokenTwo.address,
				tokenWithFee.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('67'))
			expect(amounts[1]).to.be.eq(parseEther('199.637296986192962787'))

			await expect(() =>
				Router.connect(userOne).swapExactTokensForTokensSupportingFeeOnTransferTokens(
					parseEther('67'), // amountIn,
					constants.Zero, // amountOutMin,
					[TokenTwo.address, tokenWithFee.address], // path,
					userOne.address, // to,
					timestamp // deadline
				)
			).to.changeTokenBalance(tokenWithFee, userOne, parseEther('199.038385095234383898'))

			// Check pair's reserves
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERCfee.address)
			const reserveTWF = await tokenWithFee.balanceOf(PairERCtoERCfee.address)

			// 100 + 67
			expect(reserveTKN2).to.be.eq(parseEther('167'))
			// 498.5 - 199.637296986192962787
			expect(reserveTWF).to.be.eq(parseEther('298.862703013807037213'))
		})

		it('Swap exact ETH for TWF', async () => {
			// userOne already gave approve TokenWithFee --> Router

			// amountIn * 997 * reserveOut / reserveIn * 1000 + amountIn * 997
			// 2.3333e18 * 997 * 498.5e18 / 5e18 * 1000 + 2.3333e18 * 997 =
			// 1.15966059985e+42 / 7.3263001e+21 =
			// 158287346139424455189 or 158.287346139424455189 TWF
			// Just one translation of tokens from a couple to the user --> -0.3% fee
			// 158.287346139424455189 * 0.997 = 157.812484101006181823 TWF

			const amounts = await Router.getAmountsOut(parseEther('2.3333'), [
				WETH.address,
				tokenWithFee.address,
			])

			expect(amounts[0]).to.be.eq(parseEther('2.3333'))
			expect(amounts[1]).to.be.eq(parseEther('158.287346139424455189'))

			await expect(() =>
				Router.connect(userOne).swapExactETHForTokensSupportingFeeOnTransferTokens(
					constants.Zero, // amountOutMin,
					[WETH.address, tokenWithFee.address], // path,
					userOne.address, // to,
					timestamp, // deadline
					{ value: parseEther('2.3333') }
				)
			).to.changeTokenBalance(tokenWithFee, userOne, parseEther('157.812484101006181823'))

			// Check pair's reserves
			const reserveTWF = await tokenWithFee.balanceOf(PairETHtoERCfee.address)
			const reserveWETH = await WETH.balanceOf(PairETHtoERCfee.address)

			// 498.5 - 158.287346139424455189
			expect(reserveTWF).to.be.eq(parseEther('340.212653860575544811'))
			// 5 + 2.3333
			expect(reserveWETH).to.be.eq(parseEther('7.3333'))
		})
	})

	// TODO remove liquidity after swap
})

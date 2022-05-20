import { expect } from 'chai'
import { ethers } from 'hardhat'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, constants } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

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

	describe('Add liquidity', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('2000'))
			await TokenTwo.mint(userOne.address, parseEther('2000'))

			await TokenOne.connect(userOne).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userOne).approve(Router.address, constants.MaxUint256)

			await TokenOne.mint(userTwo.address, parseEther('2000'))
			await TokenTwo.mint(userTwo.address, parseEther('2000'))

			await TokenOne.connect(userTwo).approve(Router.address, constants.MaxUint256)
			await TokenTwo.connect(userTwo).approve(Router.address, constants.MaxUint256)
		})

		it('Add liquidity with pair creation', async () => {
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

		it('Add liquidity with a token that has a fee', async () => {
			await tokenWithFee.mint(userOne.address, parseEther('200'))

			// UserOne already gave approve for TokenOne --> Router
			await tokenWithFee.connect(userOne).approve(Router.address, parseEther('200'))

			// Create TokenWithFee - TokenOne pair
			await expect(
				Router.connect(userOne).addLiquidity(
					TokenOne.address, // tokenA
					tokenWithFee.address, // tokenB
					parseEther('20'), // amountADesired
					parseEther('100'), // amountBDesired
					parseEther('1'), // amountAMin
					parseEther('1'), // amountBMin
					userOne.address, // to
					timestamp // deadline
				)
			).to.emit(Factory, 'PairCreated')

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, tokenWithFee.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// Checking that the token has taken a fee 0.3%
			expect(await tokenWithFee.balanceOf(PairERCtoERC.address)).to.be.eq(
				parseEther('99.700000000000000000')
			)

			// sqrt(20e18 * 99.7e18) - 1000 =
			// 44654227123532212252 or 44.654227123532212252 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoERC.connect(userOne).balanceOf(userOne.address)).to.be.eq(
				parseEther('44.654227123532212252')
			)
		})

		it('Add liquidity with a token that has a 6 decimals', async () => {
			const decimals = await tokenWith6Decimals.decimals()

			await tokenWith6Decimals.mint(userTwo.address, BigNumber.from(200 * 10 ** decimals))

			// UserTwo already gave approve for TokenTwo --> Router
			await tokenWith6Decimals.connect(userTwo).approve(Router.address, constants.MaxUint256)

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

			// // Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenTwo.address, tokenWith6Decimals.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// sqrt(20e18 * 200e6) - 1000 =
			// 63245553202367 or 0.00063245553202367 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoERC.connect(userTwo).balanceOf(userTwo.address)).to.be.eq(
				parseEther('0.000063245553202367')
			)
		})
	})
})

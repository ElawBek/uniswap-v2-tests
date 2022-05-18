import { expect } from 'chai'
import { ethers } from 'hardhat'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, BigNumber } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

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

	xdescribe('Add liquidity', () => {
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
			await expect(
				Router.connect(userOne).addLiquidity(
					TokenOne.address,
					TokenTwo.address,
					parseEther('5'),
					parseEther('20'),
					parseEther('1'),
					parseEther('1'),
					userOne.address,
					timestamp
				)
			).to.emit(Factory, 'PairCreated')

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// Check LP-Balance for UserOne
			// sqrt(5 * 1e18 * 20 * 1e18) - 1000 =
			// 9999999999999999000 or 9.999999999999999000 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoERC.connect(userOne).balanceOf(userOne.address)).to.be.eq(
				BigNumber.from('9999999999999999000')
			)

			// Check pair's reserves
			const { _reserve0, _reserve1 } = await PairERCtoERC.connect(userOne).getReserves()

			expect(_reserve0).to.be.eq(parseEther('20'))
			expect(_reserve1).to.be.eq(parseEther('5'))
		})

		it('Add liquidity to the existing pair', async () => {
			await Router.connect(userOne).addLiquidity(
				TokenOne.address,
				TokenTwo.address,
				parseEther('5'),
				parseEther('20'),
				parseEther('1'),
				parseEther('1'),
				userOne.address,
				timestamp
			)

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			await expect(
				() =>
					Router.connect(userTwo).addLiquidity(
						TokenTwo.address,
						TokenOne.address,
						parseEther('200'),
						parseEther('50'),
						constants.Zero,
						constants.Zero,
						userTwo.address,
						timestamp
					)
				// sqrt(200 * 1e18 * 50 * 1e18) = 100 * 1e18
			).to.changeTokenBalance(PairERCtoERC.connect(userTwo), userTwo, parseEther('100'))

			// Check pair's reserves
			const { _reserve0, _reserve1 } = await PairERCtoERC.connect(userOne).getReserves()
			const totalSupplyLP = await PairERCtoERC.connect(userOne).totalSupply()

			expect(_reserve0).to.be.eq(parseEther('220'))
			expect(_reserve1).to.be.eq(parseEther('55'))
			expect(totalSupplyLP).to.be.eq(parseEther('110'))

			// Adding liquidity with an unequal coefficient
			await expect(
				() =>
					Router.connect(userOne).addLiquidity(
						TokenTwo.address,
						TokenOne.address,
						parseEther('60'),
						parseEther('50'),
						constants.Zero,
						constants.Zero,
						userOne.address,
						timestamp
					)
				// The smallest of the formula is selected: amount * totalSupply / reserve
				// 60 * 1e18 * 110 * 1e18 / 220 * 1e18 = 30000000000000000000 or 30 LP
				// 50 * 1e18 * 110 * 1e18 / 55 * 1e18 = 100000000000000000000 or 100 LP
			).to.changeTokenBalance(PairERCtoERC.connect(userOne), userOne, parseEther('30'))
		})

		it('Add liquidity with ETH', async () => {
			await expect(
				await Router.connect(userOne).addLiquidityETH(
					TokenOne.address,
					parseEther('1000'),
					constants.Zero,
					constants.Zero,
					userOne.address,
					timestamp,
					{ value: parseEther('2') }
				)
			).to.changeEtherBalance(userOne, parseEther('-2'))

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, WETH.address)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPair)

			// sqrt(1000 * 1e18 * 2 * 1e18) - 1000 =
			// 44721359549995792928 or 44.721359549995792928 LP-tokens
			// 1000 - MINIMUM_LIQUIDITY
			expect(await PairERCtoWETH.connect(userOne).balanceOf(userOne.address)).to.be.eq(
				BigNumber.from('44721359549995792928')
			)

			// Check pair's reserves
			const { _reserve0, _reserve1 } = await PairERCtoWETH.connect(userOne).getReserves()

			expect(_reserve0).to.be.eq(parseEther('1000'))
			expect(_reserve1).to.be.eq(parseEther('2'))
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

			await Router.connect(userOne).addLiquidity(
				TokenOne.address,
				TokenTwo.address,
				parseEther('5'),
				parseEther('20'),
				parseEther('1'),
				parseEther('1'),
				userOne.address,
				timestamp
			)

			await Router.connect(userTwo).addLiquidity(
				TokenTwo.address,
				TokenOne.address,
				parseEther('200'),
				parseEther('50'),
				constants.Zero,
				constants.Zero,
				userTwo.address,
				timestamp
			)

			await Router.connect(userOne).addLiquidityETH(
				TokenOne.address,
				parseEther('1000'),
				constants.Zero,
				constants.Zero,
				userOne.address,
				timestamp,
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
			// For TokenOne: 5 * 1e18 * 55 * 1e18 / 110 * 1e18 = 2.5 TKN1
			// For TokenTwo: 5 * 1e18 * 220 * 1e18 / 110 * 1e18 = 10 TKN2
			await expect(() =>
				Router.connect(userOne).removeLiquidity(
					TokenOne.address,
					TokenTwo.address,
					parseEther('5'),
					parseEther('2.3'),
					parseEther('9.5'),
					userOne.address,
					timestamp
				)
			)
				.to.emit(PairERCtoERC.connect(userOne), 'Burn')
				.to.changeTokenBalance(PairERCtoERC.connect(userOne), userOne, parseEther('-5'))

			const { _reserve0, _reserve1 } = await PairERCtoERC.connect(userOne).getReserves()

			// 210 - 10
			expect(_reserve0).to.be.eq(parseEther('210'))
			// 55 - 2.5
			expect(_reserve1).to.be.eq(parseEther('52.5'))
		})

		it('Remove Liquidity with ETH', async () => {
			await PairERCtoWETH.connect(userOne).approve(Router.address, constants.MaxUint256)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 22360679774997896964 * 1000 * 1e18 / 44721359549995793928 = 500 TKN1
			// For TokenTwo: 22360679774997896964 * 2 * 1e18 / 44721359549995793928 = 1 ETH
			await expect(() =>
				Router.connect(userOne).removeLiquidityETH(
					TokenOne.address,
					BigNumber.from('22360679774997896964'),
					parseEther('200'),
					parseEther('0.6'),
					userOne.address,
					timestamp
				)
			)
				.to.emit(PairERCtoWETH.connect(userOne), 'Sync')
				.to.changeTokenBalance(
					PairERCtoWETH.connect(userOne),
					userOne,
					BigNumber.from('-22360679774997896964')
				)

			const { _reserve0, _reserve1 } = await PairERCtoWETH.connect(userOne).getReserves()

			// 1000 - 500
			expect(_reserve1).to.be.eq(parseEther('500'))
			// 2 - 1
			expect(_reserve0).to.be.eq(parseEther('1'))
		})
	})

	// TODO remove liquidity after swaps
	// TODO add liquidity with token less 18 decimals
	// TODO test with feeTo == true
})

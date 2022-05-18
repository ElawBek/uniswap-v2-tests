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

	describe('Add liquidity', () => {
		beforeEach(async () => {
			await TokenOne.mint(userOne.address, parseEther('1000'))
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
			expect(
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
			)

			// Make the pair's contract callable
			const createdPair = await Factory.getPair(TokenOne.address, TokenTwo.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPair)

			// sqrt(200 * 1e18 * 50 * 1e18) = 100 * 1e18
			await expect(() =>
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
			).to.changeTokenBalance(PairERCtoERC.connect(userTwo), userTwo, parseEther('100'))

			// Check pair's reserves
			const { _reserve0, _reserve1 } = await PairERCtoERC.connect(userOne).getReserves()

			expect(_reserve0).to.be.eq(parseEther('220'))
			expect(_reserve1).to.be.eq(parseEther('55'))
		})

		it('addLiquidityWithEth', async () => {
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
})

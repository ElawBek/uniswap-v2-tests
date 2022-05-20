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

	describe('Remove liquidity', () => {
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

			// Create TokenWithFee - ETH pair
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

			// TokenTwo -- TokenWith6Decimals
			const createdPairTokenWith6 = await Factory.getPair(
				TokenTwo.address,
				tokenWith6Decimals.address
			)
			PairERCtoERC6 = new UniswapV2Pair__factory().attach(createdPairTokenWith6)
		})

		it('Remove TokenOne and TokenTwo Liquidity', async () => {
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

		it('Remove TokenOne and WETH liquidity', async () => {
			await PairERCtoWETH.connect(userOne).approve(Router.address, constants.MaxUint256)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenOne: 22360679774997896964 * 1000e18 / 44721359549995793928 = 500 TKN1
			// For WETH: 22360679774997896964 * 2e18 / 44721359549995793928 = 1 ETH
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

		it('Remove TokenOne and TokenTwo liquidity with permit', async () => {
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

		it('Remove ETH and TokenOne liquidity with permit', async () => {
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
			// For WETH: 12e18 * 2e18 / 44721359549995793928 = 0.536656314599949527 ETH
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

		it('Remove TokenTwo and TokenWith6Decimals liquidity with permit', async () => {
			// userTwo has 0.000063245553202367 LP-tokens
			// remove the quarter
			const result = await signERC2612Permit(
				userTwo,
				PairERCtoERC6.address,
				userTwo.address,
				Router.address,
				'15811388300591'
			)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For TokenTwo: 0.000015811388300591 * 20e18 / 0.000063245553203367 = 4.999999999920705887 TKN2
			// For TokenWith6Decimals: 0.000015811388300591 * 200e6 / 0.000063245553203367 = 49.999999 TW6
			await expect(() =>
				Router.connect(userTwo).removeLiquidityWithPermit(
					TokenTwo.address, // tokenA,
					tokenWith6Decimals.address, // tokenB,
					parseEther('0.000015811388300591'), // liquidity,
					parseEther('4'), // amountAMin,
					BigNumber.from(40 * 10 ** 6), // amountBMin,
					userTwo.address, // to,
					result.deadline, // deadline,
					false, // approveMax,
					result.v, // v,
					result.r, // r,
					result.s // s
				)
			).to.changeTokenBalance(
				PairERCtoERC6.connect(userTwo),
				userTwo,
				parseEther('-0.000015811388300591')
			)

			// Check pair's reserves
			const reserveTKN2 = await TokenTwo.balanceOf(PairERCtoERC6.address)
			const reserveTW6 = await tokenWith6Decimals.balanceOf(PairERCtoERC6.address)

			// 20 - 4.999999999920705887 = 15.000000000079294113
			expect(reserveTKN2).to.be.eq(parseEther('15.000000000079294113'))
			// 200 - 49.999999 = 150.000001
			expect(reserveTW6).to.be.eq(BigNumber.from('150000001'))
		})

		it('Remove ETH and TokenWithFee liquidity', async () => {
			// userOne has 49.924943665466462899

			await PairETHtoERCfee.connect(userOne).approve(Router.address, parseEther('1'))

			// reserveTWF: 498.5 TWF
			// reserveWETH: 5 ETH

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For WETH: 0.924943665466462899 * 5e18 / 49.924943665466463899 = 0.092633421047428724 ETH
			// For TokenWithFee:
			// First, the token is transferred to the router’s contract --> -0.3% (token fee)
			// After that, the token is transferred to the userOne --> -0.3%
			// 0.924943665466462899 * 498.5e18 / 49.924943665466463899 = 9.235552078428643801 TWF (without fee)
			// 9.235552078428643801 * 0.997 * 0.997 = 9.180221885926777795 TWF
			await expect(() =>
				Router.connect(userOne).removeLiquidityETHSupportingFeeOnTransferTokens(
					tokenWithFee.address,
					parseEther('0.924943665466462899'),
					constants.Zero,
					constants.Zero,
					userOne.address,
					timestamp
				)
			).to.changeTokenBalance(tokenWithFee, userOne, parseEther('9.180221885926777795'))

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairETHtoERCfee.address)
			const reserveTWF = await tokenWithFee.balanceOf(PairETHtoERCfee.address)

			// 5 - 0.092633421047428724 = 4.907366578952571276
			expect(reserveWETH).to.be.eq(parseEther('4.907366578952571276'))
			// 498.5 - 9.235552078428643801 = 489.264447921571356199
			expect(reserveTWF).to.be.eq(parseEther('489.264447921571356199'))
		})

		it('Remove ETH and TokenWithFee liquidity with permit', async () => {
			// userOne has 49.924943665466462899

			const result = await signERC2612Permit(
				userOne,
				PairETHtoERCfee.address,
				userOne.address,
				Router.address,
				'924943665466462899'
			)

			// To calculate the output tokens:
			// liquidity * balance / totalSupplyLP
			// For WETH: 0.924943665466462899 * 5e18 / 49.924943665466463899 = 0.092633421047428724 ETH
			// For TokenWithFee:
			// First, the token is transferred to the router’s contract --> -0.3% (token fee)
			// After that, the token is transferred to the userOne --> -0.3%
			// 0.924943665466462899 * 498.5e18 / 49.924943665466463899 = 9.235552078428643801 TWF (without fee)
			// 9.235552078428643801 * 0.997 * 0.997 = 9.180221885926777795 TWF
			await expect(() =>
				Router.connect(userOne).removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
					tokenWithFee.address, // token,
					parseEther('0.924943665466462899'), // liquidity,
					constants.Zero, // amountTokenMin,
					constants.Zero, // amountETHMin,
					userOne.address, // to,
					result.deadline, // deadline,
					false, // approveMax,
					result.v, // v,
					result.r, // r,
					result.s // s
				)
			).to.changeTokenBalance(tokenWithFee, userOne, parseEther('9.180221885926777795'))

			// Check pair's reserves
			const reserveWETH = await WETH.balanceOf(PairETHtoERCfee.address)
			const reserveTWF = await tokenWithFee.balanceOf(PairETHtoERCfee.address)

			// 5 - 0.092633421047428724 = 4.907366578952571276
			expect(reserveWETH).to.be.eq(parseEther('4.907366578952571276'))
			// 498.5 - 9.235552078428643801 = 489.264447921571356199
			expect(reserveTWF).to.be.eq(parseEther('489.264447921571356199'))
		})
	})
})

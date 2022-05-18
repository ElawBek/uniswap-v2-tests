import { expect } from 'chai'
import { ethers } from 'hardhat'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants } from 'ethers'

import {
	WETH9,
	WETH9__factory,
	Token,
	Token__factory,
	UniswapV2Pair,
	UniswapV2Pair__factory,
	UniswapV2Factory,
	UniswapV2Factory__factory,
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
	})

	describe('Factory', () => {
		it('Change feeSetter and feeTo', async () => {
			expect(await Factory.feeToSetter()).to.be.eq(owner.address)
			expect(await Factory.feeTo()).to.be.eq(constants.AddressZero)

			await expect(Factory.connect(userOne).setFeeToSetter(userOne.address)).to.be.revertedWith(
				'UniswapV2: FORBIDDEN'
			)

			await expect(Factory.connect(userOne).setFeeTo(userOne.address)).to.be.revertedWith(
				'UniswapV2: FORBIDDEN'
			)

			await Factory.setFeeTo(owner.address)
			await Factory.setFeeToSetter(userOne.address)

			expect(await Factory.feeToSetter()).to.be.eq(userOne.address)
			expect(await Factory.feeTo()).to.be.eq(owner.address)

			await Factory.connect(userOne).setFeeTo(userTwo.address)

			expect(await Factory.feeTo()).to.be.eq(userTwo.address)
		})

		it('Create pair', async () => {
			expect(await Factory.allPairsLength()).to.be.eq(constants.Zero)
			expect(await Factory.getPair(TokenOne.address, TokenTwo.address)).to.be.eq(
				constants.AddressZero
			)

			await expect(Factory.createPair(TokenOne.address, TokenOne.address)).to.be.revertedWith(
				'UniswapV2: IDENTICAL_ADDRESSES'
			)

			await expect(Factory.createPair(TokenOne.address, constants.AddressZero)).to.be.revertedWith(
				'UniswapV2: ZERO_ADDRESS'
			)

			await Factory.createPair(TokenOne.address, TokenTwo.address)

			expect(await Factory.allPairsLength()).to.be.eq(constants.One)

			await expect(
				Factory.connect(userTwo).createPair(TokenTwo.address, TokenOne.address)
			).to.be.revertedWith('UniswapV2: PAIR_EXISTS')

			await Factory.connect(userOne).createPair(WETH.address, TokenThree.address)

			expect(await Factory.allPairsLength()).to.be.eq(constants.Two)

			const createdPairERCtoERC = await Factory.getPair(TokenTwo.address, TokenOne.address)
			const createdPairERCtoWETH = await Factory.getPair(WETH.address, TokenThree.address)

			// Make the pair's contracts callable
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairERCtoERC)
			PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPairERCtoWETH)

			expect(PairERCtoERC.address).to.eq(createdPairERCtoERC)
			expect(PairERCtoWETH.address).to.eq(createdPairERCtoWETH)

			expect(await Factory.createPair(TokenTwo.address, WETH.address)).to.emit(
				Factory.address,
				'PairCreated'
			)
		})
	})

	describe('Pair', () => {
		beforeEach(async () => {
			await Factory.createPair(TokenOne.address, TokenTwo.address)

			// Make the pair's contract callable
			const createdPairERCtoERC = await Factory.getPair(TokenTwo.address, TokenOne.address)
			PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairERCtoERC)
		})

		it('Checking variables', async () => {
			expect(await PairERCtoERC.connect(owner).factory()).to.eq(Factory.address)
			expect(await PairERCtoERC.connect(owner).token0()).to.eq(TokenOne.address)
			expect(await PairERCtoERC.connect(owner).token1()).to.eq(TokenTwo.address)

			const { _reserve0, _reserve1 } = await PairERCtoERC.connect(owner).getReserves()

			expect(_reserve0).to.eq(constants.Zero)
			expect(_reserve1).to.eq(constants.Zero)
		})
	})
})

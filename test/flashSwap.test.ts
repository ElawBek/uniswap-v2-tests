import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants } from "ethers";
import { parseEther, formatEther } from "ethers/lib/utils";

const timestamp = ethers.BigNumber.from(1852640309);

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
  FlashSwap,
  FlashSwap__factory,
} from "../typechain-types";

describe("APP", () => {
  let owner: SignerWithAddress;
  let userOne: SignerWithAddress;

  let WETH: WETH9;

  let TokenOne: Token;
  let TokenTwo: Token;

  let Factory: UniswapV2Factory;
  let Router: UniswapV2Router02;

  let PairERCtoERC: UniswapV2Pair;
  let PairERCtoWETH: UniswapV2Pair;

  let flashSwap: FlashSwap;

  beforeEach(async () => {
    [owner, userOne] = await ethers.getSigners();

    // Deploy WETH contract
    WETH = await new WETH9__factory(owner).deploy();

    // Deploy tokens for test
    TokenOne = await new Token__factory(owner).deploy("tokenOne", "TK1");
    TokenTwo = await new Token__factory(owner).deploy("tokenTwo", "TK2");

    // Deploy Factory
    Factory = await new UniswapV2Factory__factory(owner).deploy(owner.address);

    // Deploy Router
    Router = await new UniswapV2Router02__factory(owner).deploy(
      Factory.address,
      WETH.address
    );

    // Deploy contract for FlashSwap
    flashSwap = await new FlashSwap__factory(userOne).deploy(Factory.address);
  });

  describe("Flash Swap", () => {
    beforeEach(async () => {
      await TokenOne.mint(owner.address, parseEther("1500000"));
      await TokenOne.approve(Router.address, constants.MaxUint256);

      await TokenTwo.mint(owner.address, parseEther("100000"));
      await TokenTwo.approve(Router.address, constants.MaxUint256);

      await TokenOne.mint(userOne.address, parseEther("4000"));

      await TokenTwo.mint(userOne.address, parseEther("2000"));

      // create TokenOne - TokenTwo pair
      await Router.addLiquidity(
        TokenOne.address, // tokenA,
        TokenTwo.address, // tokenB,
        parseEther("1000000"), // amountADesired,
        parseEther("100000"), // amountBDesired,
        constants.Zero, // amountAMin,
        constants.Zero, // amountBMin,
        owner.address, // to,
        timestamp // deadline
      );

      // create TokenOne - WETH pair
      await Router.addLiquidityETH(
        TokenOne.address, // token,
        parseEther("500000"), // amountTokenDesired,
        constants.Zero, // amountTokenMin,
        constants.Zero, // amountETHMin,
        owner.address, // to,
        timestamp, // deadline
        { value: parseEther("2000") }
      );

      // Make the pair's contracts callable

      // TokenOne -- TokenTwo
      const createdPairTokens = await Factory.getPair(
        TokenOne.address,
        TokenTwo.address
      );
      PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairTokens);

      // TokenOne -- WETH
      const createdPairWithETH = await Factory.getPair(
        TokenOne.address,
        WETH.address
      );
      PairERCtoWETH = new UniswapV2Pair__factory().attach(createdPairWithETH);
    });

    it("FlashSwap in WETH/TKN1 pair", async () => {
      const amountWETH = parseEther("1800");
      // about 0.3%
      // fee = ((amount * 3) / 997) + 1
      const fee = parseEther("5.416248746238716149");

      // sending tokens to pay the fee for flashSwap

      await WETH.connect(userOne).deposit({ value: fee });
      await WETH.connect(userOne).transfer(flashSwap.address, fee);

      const flashSwapTest = await flashSwap.flashSwap(
        WETH.address,
        TokenOne.address,
        amountWETH
      );

      const flashSwapTestMined = await flashSwapTest.wait();

      if (flashSwapTestMined.events) {
        const num = 5;

        for (let i = 1; i <= num; i++) {
          let logs = flashSwapTestMined.events[i].args;
          console.log(`${logs?.message}: ${formatEther(logs?.value)}`);
        }
      }

      // fee
      // 2000 + 5.416248746238716149
      expect(await WETH.balanceOf(PairERCtoWETH.address)).to.be.eq(
        parseEther("2005.416248746238716149")
      );
    });

    it("FlashSwap in TKN2/TKN1 pair", async () => {
      const amountTKN1 = parseEther("990123");
      // about 0.3%
      // fee = ((amount * 3) / 997) + 1
      const fee = parseEther("2979.306920762286860582");

      // sending tokens to pay the fee for flashSwap
      await TokenOne.connect(userOne).transfer(flashSwap.address, fee);

      const flashSwapTest = await flashSwap.flashSwap(
        TokenOne.address,
        TokenTwo.address,
        amountTKN1
      );

      const flashSwapTestMined = await flashSwapTest.wait();

      if (flashSwapTestMined.events) {
        const num = 5;

        for (let i = 1; i <= num; i++) {
          let logs = flashSwapTestMined.events[i].args;
          console.log(`${logs?.message}: ${formatEther(logs?.value)}`);
        }
      }

      // fee
      // 1000000 + 2979.306920762286860582
      expect(await TokenOne.balanceOf(PairERCtoERC.address)).to.be.eq(
        parseEther("1002979.306920762286860582")
      );
    });
  });
});

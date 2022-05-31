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
  UniswapV2TWAP,
  UniswapV2TWAP__factory,
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

  let TWAP: UniswapV2TWAP;

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
  });

  describe("TWAP", () => {
    beforeEach(async () => {
      await TokenOne.mint(userOne.address, parseEther("5000"));
      await TokenOne.connect(userOne).approve(
        Router.address,
        constants.MaxUint256
      );

      await TokenTwo.mint(userOne.address, parseEther("5000"));
      await TokenTwo.connect(userOne).approve(
        Router.address,
        constants.MaxUint256
      );

      // create TokenOne - TokenTwo pair
      await Router.connect(userOne).addLiquidity(
        TokenOne.address, // tokenA,
        TokenTwo.address, // tokenB,
        parseEther("3000"), // amountADesired,
        parseEther("1000"), // amountBDesired,
        constants.Zero, // amountAMin,
        constants.Zero, // amountBMin,
        userOne.address, // to,
        timestamp // deadline
      );

      // Make the pair's contract callable

      // TokenOne -- TokenTwo
      const createdPairTokens = await Factory.getPair(
        TokenOne.address,
        TokenTwo.address
      );
      PairERCtoERC = new UniswapV2Pair__factory().attach(createdPairTokens);

      TWAP = await new UniswapV2TWAP__factory(owner).deploy(
        PairERCtoERC.address
      );
    });

    it("Checking the functionality", async () => {
      console.log("price0CumulativeLast", await TWAP.price0CumulativeLast());
      console.log("price1CumulativeLast", await TWAP.price1CumulativeLast());
      console.log("blockTimestampLast", await TWAP.blockTimestampLast());
      console.log("price0Average", await TWAP.price0Average());
      console.log("price1Average", await TWAP.price1Average());

      await Router.connect(userOne).swapTokensForExactTokens(
        parseEther("120"), // amountOut,
        parseEther("1500"), // amountInMax,
        [TokenTwo.address, TokenOne.address], // path,
        userOne.address, // to,
        timestamp // deadline
      );

      await ethers.provider.send("evm_increaseTime", [450]);

      await TWAP.update();
      console.log(
        "price0CumulativeLast",
        formatEther(await TWAP.price0CumulativeLast())
      );
      console.log(
        "price1CumulativeLast",
        formatEther(await TWAP.price1CumulativeLast())
      );
      console.log("blockTimestampLast", await TWAP.blockTimestampLast());
      console.log("price0Average", formatEther(await TWAP.price0Average()));
      console.log("price1Average", formatEther(await TWAP.price1Average()));

      console.log(
        formatEther(await TWAP.consult(TokenOne.address, parseEther("120")))
      );
    });
  });
});

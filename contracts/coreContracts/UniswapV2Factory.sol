// This contract creates the pair exchanges

// SPDX-License-Identifier: MIT

pragma solidity =0.5.16;

import "./interfaces/IUniswapV2Factory.sol";
import "./UniswapV2Pair.sol";

contract UniswapV2Factory is IUniswapV2Factory {
  // =====================================================
  //    Variables
  // =====================================================

  // These state variables are necessary to implement the protocol fee.
  // The feeTo address accumulates the liquidity tokens for the protocol fee,
  // and feeToSetter is the address allowed to change feeTo to a different address.
  address public feeTo;
  address public feeToSetter;

  // These variables keep track of the pairs, the exchanges between two token types.

  // getPair, is a mapping that identifies a pair exchange contract based on the two ERC-20 tokens it exchanges.
  mapping(address => mapping(address => address)) public getPair;

  // allPairs, is an array that includes all the addresses of pair exchanges created by this factory.
  // In Ethereum you cannot iterate over the content of a mapping, or get a list of all the keys,
  // so this variable is the only way to know which exchanges this factory manages.
  address[] public allPairs;

  // =====================================================
  //    Events
  // =====================================================

  // This event is emitted when a new pair exchange is created.
  // It includes the tokens' addresses, the pair exchange's address, and the total number of exchanges managed by the factory.
  event PairCreated(
    address indexed token0,
    address indexed token1,
    address pair,
    uint256
  );

  // =====================================================
  //    Setup Functions
  // =====================================================
  constructor(address _feeToSetter) public {
    feeToSetter = _feeToSetter;
  }

  // =====================================================
  //    Misc. functions
  // =====================================================

  // This function returns the number of exchange pairs.
  function allPairsLength() external view returns (uint256) {
    return allPairs.length;
  }

  // =====================================================
  //    Main Function
  // =====================================================

  // This is the main function of the factory, to create a pair exchange between two ERC-20 tokens.
  // Note that anybody can call this function. You do not need permission from Uniswap to create a new pair exchange.
  function createPair(address tokenA, address tokenB)
    external
    returns (address pair)
  {
    require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");

    // We want the address of the new exchange to be deterministic, so it can be calculated in advance off chain.
    // To do this we need to have a consistent order of the token addresses,
    // regardless of the order in which we have received them, so we sort them here.
    (address token0, address token1) = tokenA < tokenB
      ? (tokenA, tokenB)
      : (tokenB, tokenA);

    require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");

    require(getPair[token0][token1] == address(0), "UniswapV2: PAIR_EXISTS"); // single check is sufficient

    // To create a new contract we need the code that creates it
    // (both the constructor function and code that writes to memory the EVM bytecode of the actual contract).
    // Normally in Solidity we just use addr = new <name of contract>(<constructor parameters>) and the compiler takes care of everything for us,
    // but to have a deterministic contract address we need to use the CREATE2 opcode.
    // When this code was written that opcode was not yet supported by Solidity, so it was necessary to manually get the code.
    // This is no longer an issue, because Solidity now supports CREATE2.
    bytes memory bytecode = type(UniswapV2Pair).creationCode;

    // When an opcode is not supported by Solidity yet we can call it using inline assembly
    bytes32 salt = keccak256(abi.encodePacked(token0, token1));

    assembly {
      pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
    }

    // Call the initialize function to tell the new exchange what two tokens it exchanges.
    IUniswapV2Pair(pair).initialize(token0, token1);

    // Save the new pair information in the state variables
    getPair[token0][token1] = pair;
    getPair[token1][token0] = pair; // populate mapping in the reverse direction
    allPairs.push(pair);

    // Emit an event to inform the world of the new pair exchange.
    emit PairCreated(token0, token1, pair, allPairs.length);
  }

  // =====================================================
  //    Externally Accessible Functions
  // =====================================================

  // These two functions allow feeSetter to control the fee recipient (if any), and to change feeSetter to a new address.

  function setFeeTo(address _feeTo) external {
    require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
    feeTo = _feeTo;
  }

  function setFeeToSetter(address _feeToSetter) external {
    require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
    feeToSetter = _feeToSetter;
  }
}

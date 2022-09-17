/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts/index'
import { Market, Comptroller } from '../types/schema'
// PriceOracle is valid from Comptroller deployment until block 8498421
import { PriceOracle } from '../types/cNote/PriceOracle'
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
// import { PriceOracle2 } from '../types/cREP/PriceOracle2'
import { ERC20 } from '../types/cNote/ERC20'
import { CToken } from '../types/cNote/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
  zeroBD,
} from './helpers'
import {
  ADDRESS_ZERO,
  cCANTO_ADDRESS,
  cCANTO_ADDRESS_SMALL_CASE,
  cUSDC_ADDRESS,
} from './consts'

// Used for all cERC20 contracts
function getTokenPrice(
  blockNumber: i32,
  eventAddress: Address,
  underlyingAddress: Address,
  underlyingDecimals: i32,
): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let underlyingPrice: BigDecimal

  /* PriceOracle2 is used at the block the Comptroller starts using it.
   * see here https://etherscan.io/address/0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b#events
   * Search for event topic 0xd52b2b9b7e9ee655fcb95d2e5b9e0c9f69e7ef2b8e9d2d0ea78402d576d22e22,
   * and see block 7715908.
   *
   * This must use the cToken address.
   *
   * Note this returns the value without factoring in token decimals and wei, so we must divide
   * the number by (ethDecimals - tokenDecimals) and again by the mantissa.
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30
   *
   * Note that they deployed 3 different PriceOracles at the beginning of the Comptroller,
   * and that they handle the decimals different, which can break the subgraph. So we actually
   * defer to Oracle 1 before block 7715908, which works,
   * until this one is deployed, which was used for 121 days */
  /*
  todo
    1. how does mantissaDeicmalFactor work
    2. price oracle abi
    3. which block: if or else or both?
  */
  // if (blockNumber > 7715908) {
  let mantissaDecimalFactor = 18 - underlyingDecimals + 18
  let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
  let oracle = PriceOracle.bind(oracleAddress)
  underlyingPrice = oracle
    .getUnderlyingPrice(eventAddress)
    .toBigDecimal()
    .div(bdFactor)

  /* PriceOracle(1) is used (only for the first ~100 blocks of Comptroller. Annoying but we must
   * handle this. We use it for more than 100 blocks, see reason at top of if statement
   * of PriceOracle2.
   *
   * This must use the token address, not the cToken address.
   *
   * Note this returns the value already factoring in token decimals and wei, therefore
   * we only need to divide by the mantissa, 10^18 */
  // } else {
  //   let oracle1 = PriceOracle.bind(priceOracle1Address)
  //   underlyingPrice = oracle1
  //     .getPrice(underlyingAddress)
  //     .toBigDecimal()
  //     .div(mantissaFactorBD)
  // }
  return underlyingPrice
}

// Returns the price of USDC in eth. i.e. 0.005 would mean ETH is $200
function getUSDCpriceETH(blockNumber: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  // let priceOracle1Address = Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904')
  let USDCAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 '
  let usdPrice: BigDecimal

  // See notes on block number if statement in getTokenPrices()
  /*
  todo:
    1. what is the abi of price oracle is it the same as base v1 router
    2. how does this mantissa decimal factor work
    3. is this the correct if block or do we have to use the next one
  */
  // if (blockNumber > 7715908) {
  let oracle = PriceOracle.bind(oracleAddress)
  let mantissaDecimalFactorUSDC = 18 - 6 + 18
  let bdFactorUSDC = exponentToBigDecimal(mantissaDecimalFactorUSDC)
  usdPrice = oracle
    .getUnderlyingPrice(Address.fromString(cUSDC_ADDRESS))
    .toBigDecimal()
    .div(bdFactorUSDC)
  // } else {
  //   let oracle1 = PriceOracle.bind(priceOracle1Address)
  //   usdPrice = oracle1
  //     .getPrice(Address.fromString(USDCAddress))
  //     .toBigDecimal()
  //     .div(mantissaFactorBD)
  // }
  return usdPrice
}

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))

  // It is CETH, which has a slightly different interface
  if (marketAddress == cCANTO_ADDRESS || marketAddress == cCANTO_ADDRESS_SMALL_CASE) {
    market = new Market(marketAddress)
    market.underlyingAddress = Address.fromString(
      '0x0000000000000000000000000000000000000000',
    )
    market.underlyingDecimals = 18
    market.underlyingPrice = BigDecimal.fromString('1')
    market.underlyingName = 'Ether'
    market.underlyingSymbol = 'ETH'

    // It is all other CERC20 contracts
  } else {
    market = new Market(marketAddress)
    let underlyingAddress = Address.fromString(ADDRESS_ZERO)
    let underlyingAddressResult = contract.try_underlying()
    if (!underlyingAddressResult.reverted) {
      underlyingAddress = underlyingAddressResult.value
    } else {
      log.info('CUSTOM' + marketAddress.toString(), [])
    }
    market.underlyingAddress = underlyingAddress
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
    market.underlyingName = underlyingContract.symbol()
    market.underlyingSymbol = underlyingContract.symbol()

    if (marketAddress == cUSDC_ADDRESS) {
      market.underlyingPriceUSD = BigDecimal.fromString('1')
    }
  }

  market.borrowRate = zeroBD
  market.cash = zeroBD
  market.collateralFactor = zeroBD
  market.exchangeRate = zeroBD
  market.interestRateModelAddress = Address.fromString(
    '0x0000000000000000000000000000000000000000',
  )
  market.name = contract.name()
  market.numberOfBorrowers = 0
  market.numberOfSuppliers = 0
  market.reserves = zeroBD
  market.supplyRate = zeroBD
  market.symbol = contract.symbol()
  market.totalBorrows = zeroBD
  market.totalSupply = zeroBD
  market.underlyingPrice = zeroBD

  market.accrualBlockNumber = 0
  market.blockTimestamp = 0
  market.borrowIndex = zeroBD
  market.reserveFactor = BigInt.fromI32(0)
  market.underlyingPriceUSD = zeroBD

  return market
}

export function updateMarket(
  marketAddress: Address,
  blockNumber: i32,
  blockTimestamp: i32,
): Market {
  let marketID = marketAddress.toHexString()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }

  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    let contractAddress = Address.fromString(market.id)
    let contract = CToken.bind(contractAddress)
    let usdPriceInEth = getUSDCpriceETH(blockNumber)

    // if cETH, we only update USD price
    if (market.id == cCANTO_ADDRESS || market.id == cCANTO_ADDRESS_SMALL_CASE) {
      market.underlyingPriceUSD = market.underlyingPrice
        .div(usdPriceInEth)
        .truncate(market.underlyingDecimals)
    } else {
      let tokenPriceEth = getTokenPrice(
        blockNumber,
        contractAddress,
        market.underlyingAddress as Address,
        market.underlyingDecimals,
      )
      market.underlyingPrice = tokenPriceEth.truncate(market.underlyingDecimals)
      // if USDC, we only update ETH price
      if (market.id != cUSDC_ADDRESS) {
        market.underlyingPriceUSD = market.underlyingPrice
          .div(usdPriceInEth)
          .truncate(market.underlyingDecimals)
      }
    }

    market.accrualBlockNumber = contract.accrualBlockNumber().toI32()
    market.blockTimestamp = blockTimestamp
    market.totalSupply = contract
      .totalSupply()
      .toBigDecimal()
      .div(cTokenDecimalsBD)

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
        - If you call the cUSDC contract on etherscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDC 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */
    market.exchangeRate = contract
      .exchangeRateStored()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .times(cTokenDecimalsBD)
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)
    market.borrowIndex = contract
      .borrowIndex()
      .toBigDecimal()
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    market.reserves = contract
      .totalReserves()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.totalBorrows = contract
      .totalBorrows()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.cash = contract
      .getCash()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)

    // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
    market.supplyRate = contract
      .borrowRatePerBlock()
      .toBigDecimal()
      .times(BigDecimal.fromString('2102400'))
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
    // So we handle it like this.
    let supplyRatePerBlock = contract.try_supplyRatePerBlock()
    if (supplyRatePerBlock.reverted) {
      log.info('***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted', [])
      market.borrowRate = zeroBD
    } else {
      market.borrowRate = supplyRatePerBlock.value
        .toBigDecimal()
        .times(BigDecimal.fromString('2102400'))
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    }
    market.save()
  }
  return market as Market
}

/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts/index'
import { Market, Comptroller } from '../types/schema'
// PriceOracle is valid from Comptroller deployment until block 8498421
import { PriceOracle } from '../types/cREP/PriceOracle'
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
import { PriceOracle2 } from '../types/cREP/PriceOracle2'
import { ERC20 } from '../types/cREP/ERC20'
import { CToken } from '../types/cREP/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
} from './helpers'

let cUSDCAddress = '0x39aa39c021dfbae8fac545936693ac917d5e7563'
let cETHAddress = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5'

/* TODO
 * 1) markets need to be updated every block
 * 2) technically, if no event happened, we can do a much simpler update. but this is to be
 * added in the future after we get a working version
 * 3) this all means that update market never gets called by event handlers
 * 4) markets must be updated before events, otherwise i need to do a workaround
 * 5) price oracle only gets queried once for each block
 */

// Used for all cERC20 contracts
function getTokenPrice(
  blockNumber: i32,
  eventAddress: Address,
  underlyingAddress: Address,
  underlyingDecimals: i32,
): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let tokenPerEthRatio: BigDecimal
  let tokenPerUSDRatio: BigDecimal
  let cUSDCAddress = '0x39aa39c021dfbae8fac545936693ac917d5e7563'
  let USDCAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 '
  // let cDAIAddress = "0xf5dce57282a584d2746faf1593d3121fcac444dc" // not in use
  // let DAIAddress = "0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359 " // not in use
  let priceOracle1Address = Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904')

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
  if (blockNumber > 7715908) {
    let mantissaDecimalFactor = 18 - underlyingDecimals + 18
    let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
    let oracle2 = PriceOracle2.bind(oracleAddress)
    tokenPerEthRatio = oracle2
      .getUnderlyingPrice(eventAddress)
      .toBigDecimal()
      .div(bdFactor)
    // It is USDC, which we assume = 1 real USD (same as comptroller)
    // if (eventAddress.toHexString() == cUSDCAddress) {
    //   tokenPerUSDRatio = BigDecimal.fromString('1')
    // } else {
    //   let mantissaDecimalFactorUSDC = 18 - 6 + 18
    //   let bdFactorUSDC = exponentToBigDecimal(mantissaDecimalFactorUSDC)
    //   let usdPrice = oracle2
    //     .getUnderlyingPrice(Address.fromString(cUSDCAddress))
    //     .toBigDecimal()
    //     .div(bdFactorUSDC)
    //   tokenPerUSDRatio = tokenPerEthRatio.div(usdPrice)
    //   tokenPerUSDRatio.truncate(18)
    // }

    /* PriceOracle(1) is used (only for the first ~100 blocks of Comptroller. Annoying but we must
     * handle this. We use it for more than 100 blocks, see reason at top of if statement
     * of PriceOracle2.
     *
     * This must use the token address, not the cToken address.
     *
     * Note this returns the value already factoring in token decimals and wei, therefore
     * we only need to divide by the mantissa, 10^18 */
  } else {
    let oracle1 = PriceOracle.bind(priceOracle1Address)
    tokenPerEthRatio = oracle1
      .getPrice(underlyingAddress)
      .toBigDecimal()
      .div(mantissaFactorBD)
    // // It is USDC, which we assume = 1 real USD (same as comptroller)
    // if (eventAddress.toHexString() == cUSDCAddress) {
    //   tokenPerUSDRatio = BigDecimal.fromString('1')
    // } else {
    //   let usdPrice = oracle1
    //     .getPrice(Address.fromString(USDCAddress))
    //     .toBigDecimal()
    //     .div(mantissaFactorBD)
    //   tokenPerUSDRatio = tokenPerEthRatio.div(usdPrice)
    //   tokenPerUSDRatio.truncate(18)
    // }
  }
  return tokenPerEthRatio
}

function getUSDCpriceETH(blockNumber: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let priceOracle1Address = Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904')
  let USDCAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 '

  // let cUSDCMarket = Market.load(cUSDCAddress)
  //
  // let cETHMarket = Market.load(cETHAddress)
  // let ethPerEthRatio = BigDecimal.fromString('1')
  // let ethPerUSDRatio: BigDecimal
  let usdPrice: BigDecimal

  // See notes on block number if statement in getTokenPrices()
  if (blockNumber > 7715908) {
    let oracle2 = PriceOracle2.bind(oracleAddress)
    let mantissaDecimalFactorUSDC = 18 - 6 + 18
    let bdFactorUSDC = exponentToBigDecimal(mantissaDecimalFactorUSDC)
    usdPrice = oracle2
      .getUnderlyingPrice(Address.fromString(cUSDCAddress))
      .toBigDecimal()
      .div(bdFactorUSDC)
    // tokenPerUSDRatio = ethPerEthRatio.div(usdPrice)
    // tokenPerUSDRatio.truncate(18)
  } else {
    let oracle1 = PriceOracle.bind(priceOracle1Address)
    usdPrice = oracle1
      .getPrice(Address.fromString(USDCAddress))
      .toBigDecimal()
      .div(mantissaFactorBD)
    // tokenPerUSDRatio = tokenPerEthRatio.div(usdPrice)
    // tokenPerUSDRatio.truncate(18)
  }
  return usdPrice
}

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))
  // It is CETH, which has a slightly different interface
  if (marketAddress == cETHAddress) {
    market = new Market(marketAddress)
    market.symbol = contract.symbol()
    market.usersEntered = []
    market.underlyingAddress = Address.fromString(
      '0x0000000000000000000000000000000000000000',
    )
    market.underlyingDecimals = 18
    market.reserveFactor = BigInt.fromI32(0)
    market.tokenPerEthRatio = BigDecimal.fromString('1')
    // tokenPrices = getEthUsdPrice(blockNumber)

    // It is all other CERC20 contracts
  } else {
    market = new Market(marketAddress)
    market.symbol = contract.symbol()
    market.usersEntered = []
    market.underlyingAddress = contract.underlying()
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
    market.reserveFactor = BigInt.fromI32(0)
    if (marketAddress == cUSDCAddress) {
      market.tokenPerUSDRatio = BigDecimal.fromString('1')
    }
  }
  return market
}

function updateMarket(
  market: Market,
  usdPriceInEth: BigDecimal,
  blockNumber: i32,
): Market {
  let contractAddress = Address.fromString(market.id)
  let contract = CToken.bind(contractAddress)

  // if cETH, we only update USD price
  if (market.id == cETHAddress) {
    market.tokenPerUSDRatio = market.tokenPerEthRatio
      .div(usdPriceInEth)
      .truncate(market.underlyingDecimals)
  } else {
    let tokenPriceEth = getTokenPrice(
      blockNumber,
      contractAddress,
      market.underlyingAddress as Address,
      market.underlyingDecimals,
    )
    market.tokenPerEthRatio = tokenPriceEth.truncate(market.underlyingDecimals)
    // if USDC, we only update ETH price
    if (market.id != cUSDCAddress) {
      market.tokenPerUSDRatio = market.tokenPerEthRatio
        .div(usdPriceInEth)
        .truncate(market.underlyingDecimals)
    }
  }

  market.accrualBlockNumber = contract.accrualBlockNumber().toI32()
  market.totalSupply = contract
    .totalSupply()
    .toBigDecimal()
    .div(cTokenDecimalsBD)

  // If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
  // If you call the cUSDC contract on etherscan it comes back (2.0 * 10^14)
  // The real value is 0.02. So cDAI is off by 10^28, and cUSDC 10^16
  // Must div by tokenDecimals, 10^market.underlyingDecimals
  // Must multiple by ctokenDecimals, 10^8
  // Must div by mantissa, 10^18
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

  market.totalReserves = contract
    .totalReserves()
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)
  market.totalBorrows = contract
    .totalBorrows()
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)
  market.totalCash = contract
    .getCash()
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)
  market.totalDeposits = market.totalCash
    .plus(market.totalBorrows)
    .minus(market.totalReserves)

  // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
  market.perBlockBorrowInterest = contract
    .borrowRatePerBlock()
    .toBigDecimal()
    .div(mantissaFactorBD)
    .truncate(mantissaFactor)

  // TODO make the below more robust. technically if it fails, we can calculate
  //  on our side the value , since supply rate is a derivative of borrow
  let testing = contract.try_supplyRatePerBlock()
  if (testing.reverted) {
    log.info('***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted', [])
  } else {
    market.perBlockSupplyInterest = testing.value
      .toBigDecimal()
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)
  }
  market.save()
  return market
}

/* For now, since block triggers go last, we must trigger updateMarkets() on the first event
 * or block trigger if no events happen in a block. To do this we introduce the concept of
 * accrualBlockNumberSubgraph. If it is equal, to any market accrual block number, it  means
 * all have been updated
 */
export function updateMarkets(marketAddress: Address, blockNumber: i32): Market {
  let marketID = marketAddress.toHexString()
  let eventMarket = Market.load(marketID)
  let loopMarket: Market | null
  let comptroller = Comptroller.load('1')

  // if true, this was already ran this block, don't do it again
  if (comptroller.accrualBlockNumberSubgraph == blockNumber) {
    return eventMarket as Market
  } else {
    comptroller.accrualBlockNumberSubgraph = blockNumber
    comptroller.save()
    let usdPriceInEth = getUSDCpriceETH(blockNumber)
    /*
     * Right now we can't dynamically add a contract and start indexing it from its inception.
     * Since the Comptroller is not a factory, and you only add a market to it, it means the
     * market will exist before the comptroller is aware of it. Therefore we can't dynamically
     * add contracts until we support that since events may happen before the comptroller
     * adds the contract. Because it leaves the possibility of the market values getting out of sync.
     *
     * So, we hardcode in all contracts into the manifest, and we use that hardcoded list here,
     * and just loop. This means whenever compound adds an asset, we must update the subgraph!
     */
    let cTokens: Array<string> = [
      '0x6c8c6b02e7b2be14d4fa6022dfd6d75921d90e4e', // cBAT
      '0xf5dce57282a584d2746faf1593d3121fcac444dc', // cDAI
      '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5', // cETH
      '0x158079ee67fce2f58472a96584a73c7ab9ac95c1', // cREP
      '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
      '0xc11b1268c1a384e55c48c2391d8d480264a3a7f4', // cWBTC
      '0xb3319f5d18bc0d84dd1b4825dcde5d5f7266d407', // cZRX
    ]

    for (let i = 0; i < cTokens.length; i++) {
      loopMarket = Market.load(cTokens[i])
      if (loopMarket == null) {
        // Check if it is the eventMarket. In this case, we must create the market and update it
        if (marketID == cTokens[i]) {
          // We must pass the created market, rather that the loaded null market
          loopMarket = createMarket(cTokens[i])
          eventMarket = updateMarket(loopMarket as Market, usdPriceInEth, blockNumber)
        } else {
          // Do nothing, this market does not exist yet, so we shouldn't try to update it
        }
        // Update all other markets that exist
      } else {
        updateMarket(loopMarket as Market, usdPriceInEth, blockNumber)
      }
    }
    return eventMarket as Market
  }
}

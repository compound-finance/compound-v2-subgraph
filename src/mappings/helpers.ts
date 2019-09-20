// For each division by 10, add one to exponent to truncate one significant figure
import {Address, BigDecimal, BigInt, log} from "@graphprotocol/graph-ts/index";
import {CTokenInfo, Market, User, Comptroller} from "../types/schema";

// PriceOracle is valid from Comptroller deployment until block 8498421
import {PriceOracle} from "../types/cREP/PriceOracle";
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
import {PriceOracle2} from "../types/cREP/PriceOracle2";
import {CErc20} from "../types/cREP/CErc20";
import {ERC20} from "../types/cREP/ERC20";

function exponentToBigDecimal(decimals: i32): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)

export function getTokenPrices(blockNumber: i32, eventAddress: Address, underlyingAddress: Address, underlyingDecimals: i32): Array<BigDecimal> {
  let comptroller = Comptroller.load("1")
  let oracleAddress = comptroller.priceOracle as Address
  let tokenPerEthRatio: BigDecimal
  let tokenPerUSDRatio: BigDecimal
  let cUSDCAddress = "0x39aa39c021dfbae8fac545936693ac917d5e7563"
  let USDCAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 "
  let cDAIAddress = "0xf5dce57282a584d2746faf1593d3121fcac444dc"
  let DAIAddress = "0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359 "
  let priceOracle1Address = Address.fromString("02557a5e05defeffd4cae6d83ea3d173b272c904")


  /* PriceOracle2 is used at the block the Comptroller starts using it.
   * see here https://etherscan.io/address/0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b#events
   * This must use the cToken address.
   * Note this returns the value without factoring in token decimals and wei, so we must divide
   * the number by (ethDecimals - tokenDecimals) and again by the mantissa.
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30
   * Note that they deployed 3 different PriceOracles at the beginning of the Comptroller,
   * and that they handle the decimals different, which can break the subgraph. So we actually
   * defer to Oracle 1, which works, until this one is deployed, which was used for 121 days*/
  if (blockNumber > 7715908) {
    let mantissaDecimalFactor = 18 - underlyingDecimals + 18
    let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
    let oracle2 = PriceOracle2.bind(oracleAddress)
    tokenPerEthRatio = oracle2.getUnderlyingPrice(eventAddress).toBigDecimal().div(bdFactor)

    // It is USDC, which we assume = 1 real USD (same as comptroller)
    if (eventAddress.toHexString() == cUSDCAddress) {
      tokenPerUSDRatio = BigDecimal.fromString("1")
    } else {
      let mantissaDecimalFactorUSDC = 18 - 6 + 18
      let bdFactorUSDC = exponentToBigDecimal(mantissaDecimalFactorUSDC)
      let usdPrice = oracle2.getUnderlyingPrice(Address.fromString(cUSDCAddress)).toBigDecimal().div(bdFactorUSDC)
      let tokenPerUSDRatio = tokenPerEthRatio.div(usdPrice)
      tokenPerUSDRatio.truncate(18)
    }

    /* PriceOracle is used (only for the first ~100 blocks of Comptroller. Annoying but we must handle this.
     * We use it for more than 100 blocks, see reason at top of if statement for PriceOracle2
     * This must use the token address, not the cToken address
     * Note this returns the value already factoring in token decimals and wei, therefore
     * we only need to divide by the mantissa, 10^18 */
  } else {
    let oracle1 = PriceOracle.bind(priceOracle1Address)
    tokenPerEthRatio = oracle1.getPrice(underlyingAddress).toBigDecimal().div(mantissaFactorBD)
    // It is USDC, which we assume = 1 real USD (same as comptroller)
    if (eventAddress.toHexString() == cUSDCAddress) {
      tokenPerUSDRatio = BigDecimal.fromString("1")
    } else {
      let usdPrice = oracle1.getPrice(Address.fromString(USDCAddress)).toBigDecimal().div(mantissaFactorBD)
      let tokenPerUSDRatio = tokenPerEthRatio.div(usdPrice)
      tokenPerUSDRatio.truncate(18)
    }
  }
  return [tokenPerEthRatio, tokenPerUSDRatio]
}

export function updateMarket(marketAddress: Address, blockNumber: i32): CErc20 {
  let marketID = marketAddress.toHex()
  let market = Market.load(marketID)
  let contract = CErc20.bind(marketAddress)

  // Accrue interest can be called before mint event, so this must be here
  if (market == null) {
    market = new Market(marketID)
    market.symbol = contract.symbol()
    market.usersEntered = []
    market.underlyingAddress = contract.underlying()
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
  }

  let tokenPrices: Array<BigDecimal> = getTokenPrices(
    blockNumber,
    marketAddress,
    market.underlyingAddress as Address,
    market.underlyingDecimals
  )

  market.tokenPerEthRatio = tokenPrices[0]
  market.tokenPerUSDRatio = tokenPrices[1]

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply().toBigDecimal().div(BigDecimal.fromString("100000000"))

  // 10^28, removing 10^18 for exp precision, and then token precision / ctoken precision -> 10^18/10^8 = 10^10
  market.exchangeRate = contract.exchangeRateStored().toBigDecimal()
    .div(BigDecimal.fromString("10000000000000000000000000000"))

  market.totalReserves = contract.totalReserves().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  market.totalBorrows = contract.totalBorrows().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  market.borrowIndex = contract.borrowIndex().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))

  // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
  market.perBlockBorrowInterest = contract.borrowRatePerBlock().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  let testing = contract.try_supplyRatePerBlock() //TODO make this more robust. technically if it fails, we can calculate on our side the value , since supply rate is a derivative of borrow
  if (testing.reverted) {
    log.info("***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted", [])
  } else {
    market.perBlockSupplyInterest = testing.value.toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  }

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  let erc20TokenContract = CErc20.bind(contract.underlying())
  let cash = erc20TokenContract.balanceOf(marketAddress)
  market.totalCash = cash.toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))

  // deposits = cash + borrows - reserves
  market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)
  market.save()

  return contract
}


export function calculateLiquidty(userAddr: string): void {
  // let totalSupplyInEth = BigDecimal.fromString("0")
  // let totalBorrowInEth = BigDecimal.fromString("0")
  //
  // let dai = CTokenInfo.load('cDAI-'.concat(userAddr))
  // if (dai != null) {
  //   let daiMarket = Market.load("0x2acc448d73e8d53076731fea2ef3fc38214d0a7d") //9941
  //   let daiEthRatio = daiMarket.tokenPerEthRatio
  //   let daiBorrowInEth = dai.borrowBalance.times(daiEthRatio)
  //   let daiSupplyInEth = dai.underlyingBalance.times(daiEthRatio)
  //
  //   totalBorrowInEth = totalBorrowInEth.plus(daiBorrowInEth)
  //   totalSupplyInEth = totalSupplyInEth.plus(daiSupplyInEth)
  // }
  //
  // let rep = CTokenInfo.load('cREP-'.concat(userAddr))
  // if (rep != null) {
  //   let repMarket = Market.load("0x1c8f7aca3564c02d1bf58eba8571b6fdafe91f44") //9941
  //   let repEthRatio = repMarket.tokenPerEthRatio
  //   let repBorrowInEth = rep.borrowBalance.times(repEthRatio)
  //   let repSupplyInEth = rep.underlyingBalance.times(repEthRatio)
  //
  //   totalBorrowInEth = totalBorrowInEth.plus(repBorrowInEth)
  //   totalSupplyInEth = totalSupplyInEth.plus(repSupplyInEth)
  // }
  //
  // let zrx = CTokenInfo.load('cZRX-'.concat(userAddr))
  // if (zrx != null) {
  //   let zrxMarket = Market.load("0x961aa80b6b44d445387aa8395c4c6c1a473f4ffd") //9941
  //   let zrxEthRatio = zrxMarket.tokenPerEthRatio
  //   let zrxBorrowInEth = zrx.borrowBalance.times(zrxEthRatio)
  //   let zrxSupplyInEth = zrx.underlyingBalance.times(zrxEthRatio)
  //
  //   totalBorrowInEth = totalBorrowInEth.plus(zrxBorrowInEth)
  //   totalSupplyInEth = totalSupplyInEth.plus(zrxSupplyInEth)
  // }
  // let eth = CTokenInfo.load('cETH-'.concat(userAddr))
  // if (eth != null) {
  //   let ethMarket = Market.load("0xbed6d9490a7cd81ff0f06f29189160a9641a358f") //9941
  //   let ethEthRatio = ethMarket.tokenPerEthRatio
  //   let ethBorrowInEth = eth.borrowBalance.times(ethEthRatio)
  //   let ethSupplyInEth = eth.underlyingBalance.times(ethEthRatio)
  //
  //   totalBorrowInEth = totalBorrowInEth.plus(ethBorrowInEth)
  //   totalSupplyInEth = totalSupplyInEth.plus(ethSupplyInEth)
  // }
  // let bat = CTokenInfo.load('cBAT-'.concat(userAddr))
  // if (bat != null) {
  //   let batMarket = Market.load("0x1cae2a350af04cd2525aee6cc8397e03f50c1af4") //9941
  //   let batEthRatio = batMarket.tokenPerEthRatio
  //   let batBorrowInEth = bat.borrowBalance.times(batEthRatio)
  //   let batSupplyInEth = bat.underlyingBalance.times(batEthRatio)
  //
  //   totalBorrowInEth = totalBorrowInEth.plus(batBorrowInEth)
  //   totalSupplyInEth = totalSupplyInEth.plus(batSupplyInEth)
  // }
  //
  // let user = User.load(userAddr)
  // user.totalBorrowInEth = totalBorrowInEth
  // user.totalSupplyInEth = totalSupplyInEth
  // // If a user has borrowed, but has fully repaid, it will be 0, so we just reset to null and
  // if (totalBorrowInEth == BigDecimal.fromString("0")) {
  //   user.accountLiquidity = null
  //   user.availableToBorrowEth = null
  // } else {
  //   user.accountLiquidity = truncateBigDecimal(totalSupplyInEth.div(totalBorrowInEth), 18)
  //   user.availableToBorrowEth = truncateBigDecimal(user.totalSupplyInEth.div(BigDecimal.fromString("1.5")).minus(user.totalBorrowInEth), 18)
  // }
  // user.save()
}
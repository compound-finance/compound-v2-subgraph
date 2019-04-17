// For each division by 10, add one to exponent to truncate one significant figure
import {BigDecimal, BigInt} from "@graphprotocol/graph-ts/index";
import {CTokenInfo, Market, User} from "../types/schema";

// Must keep all values left of the decimal, and then allow user to decide how many decimals they want
export function truncateBigDecimal(bd: BigDecimal, decimalLength: i32): BigDecimal {

  // Figuring out how many digits to truncate
  // exp is negative if there are decimals, so we add it, unintuitively
  let largerThanZeroLength = bd.digits.toString().length + bd.exp.toI32()

  // if largerThanZeroLength is negative, then digit length will be less than 18, which is okay
  let newDigitLength = decimalLength + largerThanZeroLength
  let lengthToTruncate = bd.digits.toString().length - newDigitLength

  // This means it was originally smaller than desired decimalLength, so do nothing
  if (lengthToTruncate < 0) {
    return bd
  } else {
    // This will shave off the length of the full digits to what is desired
    for (let i = 0; i < lengthToTruncate; i++) {
      bd.digits = bd.digits.div(BigInt.fromI32(10))
    }
    // simply set the exp to what was desired (* -1 because it must be negative, but as parameter it is passed in postive
    bd.exp = BigInt.fromI32(decimalLength* -1)
    return bd
  }
}

/*
Because a SimplePriceOracle is used for rinkeby, we just hardcode these values in
TODO - on mainnet, we must source the PriceOracle events to get USD values
cBAT = 2000000000000000*10^-18 = 0.002 bat/eth
cDAI = 7000000000000000*10^-18 = 0.007 dai/eth - note, this essentially means 1 USD = .007, or 1 ETH = $142.857
cETH = 1000000000000000000*10^-18 = 1 eth/eth
cREP = 102000000000000000*10^-18 = .102 rep/eth
cZRX = 2200000000000000*10^-18 = 0.0022 zrx/eth
 */

export function getTokenEthRatio(symbol: string): BigDecimal {
  if (symbol == "cBAT") {
    return BigDecimal.fromString("0.002")
  } else if (symbol == "cDAI") {
    return BigDecimal.fromString("0.007")
  } else if (symbol == "cREP") {
    return BigDecimal.fromString("0.102")
  } else {
    return BigDecimal.fromString("0.0022") // else must be cZRX here
  }
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
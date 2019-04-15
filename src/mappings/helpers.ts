// For each division by 10, add one to exponent to truncate one significant figure
import {BigDecimal, BigInt} from "@graphprotocol/graph-ts/index";
import {CTokenStats, Market, User} from "../types/schema";

// TODO - repurpose this so that you pass in the amount of decimals you WANT, not the amount to truncate. We will do 18 for all, except cToken, which will be 8
// Must keep all values left of the decimal, and then allow user to decide how many decimals they want
export function truncateBigDecimal(bd: BigDecimal, decimalLength: i32): BigDecimal {
  // Figuring out how many digits to truncate
  let largerThanZeroLength = bd.digits.toString().length + bd.exp.toI32() // exp is negative if there are decimals

  // number is less than 0, we want it to be represented by 0, not by a negative number
  // if (largerThanZeroLength < 0){
  //   largerThanZeroLength = 0
  // }

  // if larger than zero length is negative, then digit length will be less than 18, which is okay
  let newDigitLength = decimalLength + largerThanZeroLength
  let lengthToTruncate = bd.digits.toString().length - newDigitLength

  // This means it was originally smaller than desired decimalLength, so do nothing
  if (lengthToTruncate < 0) {
    // bd.digits = BigInt.fromI32(bd.digits.toString().length + 687)
    // bd.exp = BigInt
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
  let totalSupplyInEth = BigDecimal.fromString("0")
  let totalBorrowInEth = BigDecimal.fromString("0")

  let dai = CTokenStats.load('cDAI-'.concat(userAddr))
  if (dai != null) {
    let daiMarket = Market.load("0xb5e5d0f8c0cba267cd3d7035d6adc8eba7df7cdd") //9941
    let daiEthRatio = daiMarket.tokenPerEthRatio
    let daiBorrowInEth = dai.borrowBalance.times(daiEthRatio)
    let daiSupplyInEth = dai.underlyingBalance.times(daiEthRatio)

    totalBorrowInEth = totalBorrowInEth.plus(daiBorrowInEth)
    totalSupplyInEth = totalSupplyInEth.plus(daiSupplyInEth)
  }

  let rep = CTokenStats.load('cREP-'.concat(userAddr))
  if (rep != null) {
    let repMarket = Market.load("0x0a1e4d0b5c71b955c0a5993023fc48ba6e380496") //9941
    let repEthRatio = repMarket.tokenPerEthRatio
    let repBorrowInEth = rep.borrowBalance.times(repEthRatio)
    let repSupplyInEth = rep.underlyingBalance.times(repEthRatio)

    totalBorrowInEth = totalBorrowInEth.plus(repBorrowInEth)
    totalSupplyInEth = totalSupplyInEth.plus(repSupplyInEth)
  }

  let zrx = CTokenStats.load('cZRX-'.concat(userAddr))
  if (zrx != null) {
    let zrxMarket = Market.load("0x19787bcf63e228a6669d905e90af397dca313cfc") //9941
    let zrxEthRatio = zrxMarket.tokenPerEthRatio
    let zrxBorrowInEth = zrx.borrowBalance.times(zrxEthRatio)
    let zrxSupplyInEth = zrx.underlyingBalance.times(zrxEthRatio)

    totalBorrowInEth = totalBorrowInEth.plus(zrxBorrowInEth)
    totalSupplyInEth = totalSupplyInEth.plus(zrxSupplyInEth)
  }
  let eth = CTokenStats.load('cETH-'.concat(userAddr))
  if (eth != null) {
    let ethMarket = Market.load("0x8a9447df1fb47209d36204e6d56767a33bf20f9f") //9941
    let ethEthRatio = ethMarket.tokenPerEthRatio
    let ethBorrowInEth = eth.borrowBalance.times(ethEthRatio)
    let ethSupplyInEth = eth.underlyingBalance.times(ethEthRatio)

    totalBorrowInEth = totalBorrowInEth.plus(ethBorrowInEth)
    totalSupplyInEth = totalSupplyInEth.plus(ethSupplyInEth)
  }
  let bat = CTokenStats.load('cBAT-'.concat(userAddr))
  if (bat != null) {
    let batMarket = Market.load("0x9636246bf34e688c6652af544418b38eb51d2c43") //9941
    let batEthRatio = batMarket.tokenPerEthRatio
    let batBorrowInEth = bat.borrowBalance.times(batEthRatio)
    let batSupplyInEth = bat.underlyingBalance.times(batEthRatio)

    totalBorrowInEth = totalBorrowInEth.plus(batBorrowInEth)
    totalSupplyInEth = totalSupplyInEth.plus(batSupplyInEth)
  }

  let user = User.load(userAddr)
  user.totalBorrowInEth = totalBorrowInEth
  user.totalSupplyInEth = totalSupplyInEth
  // If a user has borrowed, but has fully repaid, it will be 0, so we just reset to null and
  if (totalBorrowInEth == BigDecimal.fromString("0")) {
    user.accountLiquidity = null
  } else {
    user.accountLiquidity = truncateBigDecimal(totalSupplyInEth.div(totalBorrowInEth), 18) // TODO - TRUNCATE
  }
  user.availableToBorrowEth = truncateBigDecimal(user.totalSupplyInEth.div(BigDecimal.fromString("1.5")).minus(user.totalBorrowInEth), 18) // TODO - TRUNCATE
  user.save()
}
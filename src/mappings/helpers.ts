// For each division by 10, add one to exponent to truncate one significant figure
import {BigDecimal, BigInt} from "@graphprotocol/graph-ts/index";

export function truncateBigDecimal(bd: BigDecimal, truncateAmount: i32): BigDecimal {

  // This will shave off the actual digits, so our big number is getting smaller
  for (let i = 0; i < truncateAmount; i++) {
    bd.digits = bd.digits.div(BigInt.fromI32(10))
  }

  // This adds to the exponent, which is negative for numbers below zero
  // and moves the decimal point to be in line with the fact that the digits BigInt got 1 length shorter
  bd.exp = bd.exp.plus(BigInt.fromI32(truncateAmount))
  return bd
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
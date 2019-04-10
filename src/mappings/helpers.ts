// For each division by 10, add one to exponent to truncate one significant figure
import {BigDecimal, BigInt} from "@graphprotocol/graph-ts/index";

export function truncateBigDecimal(bd: BigDecimal, truncateAmount: i32):BigDecimal {

  // This will shave off the actual digits, so our big number is getting smaller
  for(let i = 0; i < truncateAmount; i++){
    bd.digits = bd.digits.div(BigInt.fromI32(10))
  }

  // This adds to the exponent, which is negative for numbers below zero
  // and moves the decimal point to be in line with the fact that the digits BigInt got 1 length shorter
  bd.exp = bd.exp.plus(BigInt.fromI32(truncateAmount))

  return bd
}
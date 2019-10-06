/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { BigDecimal, Bytes } from '@graphprotocol/graph-ts/index'
import { CTokenInfo, User } from '../types/schema'

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

/* Decimals of underlying assets
 * USCD = 6
 * WBTC = 8
 * all others = 18 */
export let mantissaFactor = 18
export let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)
export let cTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8)

export function createCTokenInfo(
  cTokenStatsID: string,
  symbol: string,
  user: string,
  marketID: string,
): CTokenInfo {
  let cTokenStats = new CTokenInfo(cTokenStatsID)
  cTokenStats.symbol = symbol
  cTokenStats.market = marketID
  cTokenStats.user = user
  cTokenStats.transactionHashes = []
  cTokenStats.transactionTimes = []
  cTokenStats.accrualBlockNumber = 0
  cTokenStats.cTokenBalance = BigDecimal.fromString('0')
  cTokenStats.totalUnderlyingSupplied = BigDecimal.fromString('0')
  cTokenStats.totalUnderlyingRedeemed = BigDecimal.fromString('0')
  cTokenStats.userBorrowIndex = BigDecimal.fromString('0')
  cTokenStats.totalUnderlyingBorrowed = BigDecimal.fromString('0')
  cTokenStats.totalUnderlyingRepaid = BigDecimal.fromString('0')
  return cTokenStats
}

export function createUser(userID: string): User {
  let user = new User(userID)
  user.cTokens = []
  user.countLiquidated = 0
  user.countLiquidator = 0
  user.totalBorrowInEth = BigDecimal.fromString('0')
  user.totalSupplyInEth = BigDecimal.fromString('0')
  user.hasBorrowed = false
  user.save()
  return user
}

export function updateCommonCTokenStats(
  marketID: string,
  marketSymbol: string,
  userID: string,
  txHash: Bytes,
  timestamp: i32,
  blockNumber: i32,
): CTokenInfo {
  let cTokenStatsID = marketID.concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(cTokenStatsID, marketSymbol, userID, marketID)
  }
  let txHashes = cTokenStats.transactionHashes
  txHashes.push(txHash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(timestamp)
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = blockNumber
  return cTokenStats as CTokenInfo
}

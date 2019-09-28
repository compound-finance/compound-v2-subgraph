/* eslint-disable prefer-const */ // to satisfy AS compiler

import { log, BigDecimal, BigInt, EthereumValue } from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  AccrueInterest,
  CToken,
  NewReserveFactor,
} from '../types/cREP/CToken'

import { Market, User, CTokenInfo } from '../types/schema'

import { calculateLiquidty, updateMarket, createCTokenInfo } from './helpers'

/*  User supplies assets into market and receives cTokens in exchange
 *  Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.mintAmount is the underlying asset
 *  event.mintTokens is the amount of cTokens minted
 *  event.minter is the user
 *  note - mints  originate from the cToken address, not 0x000000, which is typical of ERC-20s
 */
export function handleMint(event: Mint): void {
  let market = updateMarket(event.address, event.block.number.toI32())

  /********** User Below **********/
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString('0')
    user.totalSupplyInEth = BigDecimal.fromString('0')
    user.hasBorrowed = false
    user.save()
  }

  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(
      cTokenStatsID,
      market.symbol,
      event.params.minter.toHexString(),
    )
  }

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  cTokenStats.cTokenBalance = cTokenStats.cTokenBalance.plus(
    event.params.mintTokens.toBigDecimal().div(BigDecimal.fromString('100000000')),
  )

  // Get updated realized balance with the updated market exchange rate
  // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
  cTokenStats.realizedLendBalance = market.exchangeRate.times(cTokenStats.cTokenBalance)

  cTokenStats.totalUnderlyingSupplied = cTokenStats.totalUnderlyingSupplied.plus(
    event.params.mintAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  // if (user.hasBorrowed == true) {
  //   calculateLiquidty(userID)
  // }
}

/*  User supplies cTokens into market and receives underlying asset in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the user
 */
export function handleRedeem(event: Redeem): void {
  let market = updateMarket(event.address, event.block.number.toI32())

  let userID = event.params.redeemer.toHex()
  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(
      cTokenStatsID,
      market.symbol,
      event.params.redeemer.toHexString(),
    )
  }

  /********** User Updates Below **********/
  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  cTokenStats.cTokenBalance.minus(
    event.params.redeemTokens.toBigDecimal().div(BigDecimal.fromString('100000000')),
  )

  // Get updated realized balance with the updated market exchange rate
  // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
  cTokenStats.realizedLendBalance = market.exchangeRate.times(cTokenStats.cTokenBalance)

  cTokenStats.totalUnderlyingRedeemed = cTokenStats.totalUnderlyingRedeemed.plus(
    event.params.redeemAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString('0')
    user.totalSupplyInEth = BigDecimal.fromString('0')
    user.hasBorrowed = false
    user.save()
  }
  // if (user.hasBorrowed == true) {
  //   calculateLiquidty(userID)
  // }
}

/* Borrow assets from the protocol
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 */
export function handleBorrow(event: Borrow): void {
  let market = updateMarket(event.address, event.block.number.toI32())

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  // this is needed, since you could lend in one asset and borrow in another
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(
      cTokenStatsID,
      market.symbol,
      event.params.borrower.toHexString(),
    )
  }

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  cTokenStats.userBorrowIndex = market.borrowIndex
  cTokenStats.realizedBorrowBalance = cTokenStats.realizedBorrowBalance
    .times(market.borrowIndex)
    .div(cTokenStats.userBorrowIndex)

  cTokenStats.totalUnderlyingBorrowed = cTokenStats.totalUnderlyingBorrowed.plus(
    event.params.borrowAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString('0')
    user.totalSupplyInEth = BigDecimal.fromString('0')
    user.hasBorrowed = false
    user.save()
  }
  user.hasBorrowed = true
  user.save()
  calculateLiquidty(userID)
}

/* Repay some amount borrowed. Anyone can repay anyones balance
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  let market = updateMarket(event.address, event.block.number.toI32())

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  cTokenStats.userBorrowIndex = market.borrowIndex
  cTokenStats.realizedBorrowBalance = cTokenStats.realizedBorrowBalance
    .times(market.borrowIndex)
    .div(cTokenStats.userBorrowIndex)

  cTokenStats.totalUnderlyingRepaid = cTokenStats.totalUnderlyingRepaid.plus(
    event.params.repayAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )

  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString('0')
    user.totalSupplyInEth = BigDecimal.fromString('0')
    user.hasBorrowed = false
    user.save()
  }
  // if (user.hasBorrowed == true) {
  //   calculateLiquidty(userID)
  // }
}

/*
 * Note - when calling this function, event RepayBorrow, and event Transfer will be called
 * every single time too. this means we can ignore repayAmount. Seize tokens only changes state
 * of the ctokens, which is covered by transfer. therefore we don't really need to update
 * anything in this event. However, we will add a count of times liquidated and times liquidating
 *
 * event.params.borrower - the borrower who is getting liquidated of their cTokens
 * event.params.cTokenCollateral - the market ADDRESS of the ctoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - cTokens seized (transfer event should handle this)
 */

export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  updateMarket(event.address, event.block.number.toI32())

  /********** User Updates Below **********/
  let liquidatorID = event.params.liquidator.toHex()
  let liquidator = User.load(liquidatorID)
  if (liquidator == null) {
    liquidator = new User(liquidatorID)
    liquidator.countLiquidated = 0
    liquidator.countLiquidator = 0
    liquidator.cTokens = []
    liquidator.totalBorrowInEth = BigDecimal.fromString('0')
    liquidator.totalSupplyInEth = BigDecimal.fromString('0')
    liquidator.hasBorrowed = false
  }
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrowerID = event.params.borrower.toHex()
  let borrower = User.load(borrowerID)
  if (borrower == null) {
    borrower = new User(borrowerID)
    borrower.cTokens = []
    borrower.countLiquidated = 0
    borrower.countLiquidator = 0
    borrower.totalBorrowInEth = BigDecimal.fromString('0')
    borrower.totalSupplyInEth = BigDecimal.fromString('0')
    borrower.hasBorrowed = false
    borrower.save()
  }
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()

  // note - no liquidity calculations needed here. They are handled in Transfer event
  // which is always triggered by a liquidation
}

/* Possible ways to emit Transfer:
 *    seize() - i.e. a Liquidation Transfer
 *    redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *    mintFresh() - i.e. you are lending underlying assets to create ctokens
 *    transfer() - i.e. a basic transfer
 * This function handles all 4 cases, since duplicate data is emitted in the back-to-back transfer
 * The simplest way to do this is call getAccountSnapshot, in here, and leave out any cTokenBalance
 * calculations in the other function. This way we never add or subtract and deviate from the true
 * value stored in the smart contract
 *
 * event.params.from = sender of cTokens
 * event.params.to = receiver of cTokens
 * event.params.amount = amount sent
 */
export function handleTransfer(event: Transfer): void {
  let market = updateMarket(event.address, event.block.number.toI32())

  let cTokenStatsFromID = market.id.concat('-').concat(event.params.from.toHex())
  let cTokenStatsFrom = CTokenInfo.load(cTokenStatsFromID)
  let txHashesFrom = cTokenStatsFrom.transactionHashes
  txHashesFrom.push(event.transaction.hash)
  cTokenStatsFrom.transactionHashes = txHashesFrom
  let txTimesFrom = cTokenStatsFrom.transactionTimes
  txTimesFrom.push(event.block.timestamp.toI32())
  cTokenStatsFrom.transactionTimes = txTimesFrom
  cTokenStatsFrom.accrualBlockNumber = event.block.number

  let amountUnderlying = market.exchangeRate.times(event.params.amount.toBigDecimal())

  cTokenStatsFrom.cTokenBalance = cTokenStatsFrom.cTokenBalance
    .minus(event.params.amount.toBigDecimal())
    .div(BigDecimal.fromString('100000000'))

  // Get updated realized balance with the updated market exchange rate
  // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
  cTokenStatsFrom.realizedLendBalance = market.exchangeRate.times(
    cTokenStatsFrom.cTokenBalance,
  )

  cTokenStatsFrom.totalUnderlyingRedeemed = cTokenStatsFrom.totalUnderlyingRedeemed.plus(
    amountUnderlying,
  )
  cTokenStatsFrom.realizedSupplyInterest = cTokenStatsFrom.realizedLendBalance
    .minus(cTokenStatsFrom.totalUnderlyingSupplied)
    .plus(cTokenStatsFrom.totalUnderlyingRedeemed)

  cTokenStatsFrom.save()

  /********** User To Updates Below **********/
  // We do the same for userTo as userFrom, but check if user and cTokenStats entities are null
  let userToID = event.params.to.toHex()
  let userTo = User.load(userToID)
  if (userTo == null) {
    userTo = new User(userToID)
    userTo.cTokens = []
    userTo.countLiquidated = 0
    userTo.countLiquidator = 0
    userTo.totalBorrowInEth = BigDecimal.fromString('0')
    userTo.totalSupplyInEth = BigDecimal.fromString('0')
    userTo.hasBorrowed = false
    userTo.save()
  }

  let cTokenStatsToID = market.id.concat('-').concat(userToID)
  let cTokenStatsTo = CTokenInfo.load(cTokenStatsToID)
  if (cTokenStatsTo == null) {
    cTokenStatsTo = createCTokenInfo(
      cTokenStatsToID,
      market.symbol,
      event.params.to.toHexString(),
    )
  }

  let txHashesTo = cTokenStatsTo.transactionHashes
  txHashesTo.push(event.transaction.hash)
  cTokenStatsTo.transactionHashes = txHashesTo
  let txTimesTo = cTokenStatsTo.transactionTimes
  txTimesTo.push(event.block.timestamp.toI32())
  cTokenStatsTo.transactionTimes = txTimesTo
  cTokenStatsTo.accrualBlockNumber = event.block.number

  cTokenStatsTo.cTokenBalance = cTokenStatsTo.cTokenBalance.plus(
    event.params.amount.toBigDecimal(),
  )

  // Get updated realized balance with the updated market exchange rate
  // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
  cTokenStatsFrom.realizedLendBalance = market.exchangeRate.times(
    cTokenStatsFrom.cTokenBalance,
  )

  cTokenStatsTo.totalUnderlyingSupplied = cTokenStatsTo.totalUnderlyingSupplied.plus(
    amountUnderlying,
  )
  cTokenStatsTo.realizedSupplyInterest = cTokenStatsTo.realizedLendBalance
    .minus(cTokenStatsTo.totalUnderlyingSupplied)
    .plus(cTokenStatsTo.totalUnderlyingRedeemed)
  cTokenStatsTo.save()

  /********** Liquidity Updates Below **********/
  let userFromID = event.params.from.toHex()
  // TODO - hmm, this seems impossible to happen, should i still keep it? i remember an edge case liek this from the past
  let userFrom = User.load(userFromID)
  if (userFrom == null) {
    userFrom = new User(userFromID)
    userFrom.cTokens = []
    userFrom.countLiquidated = 0
    userFrom.countLiquidator = 0
    userFrom.totalBorrowInEth = BigDecimal.fromString('0')
    userFrom.totalSupplyInEth = BigDecimal.fromString('0')
    userFrom.hasBorrowed = false
    userFrom.save()
  }
  // if (userFrom.hasBorrowed == true) {
  //   calculateLiquidty(userFromID)
  // }
  // calculateLiquidty(userToID)
}

export function handleAccrueInterest(event: AccrueInterest): void {
  updateMarket(event.address, event.block.number.toI32())
}

export function handleNewReserveFactor(event: NewReserveFactor): void {
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  market.reserveFactor = event.params.newReserveFactorMantissa
  market.save()
}

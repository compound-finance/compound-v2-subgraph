/* eslint-disable prefer-const */ // to satisfy AS compiler
import { BigDecimal } from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  AccrueInterest,
  NewReserveFactor,
} from '../types/cREP/CToken'

import { Market, User } from '../types/schema'

import {
  calculateLiquidty,
  updateMarket,
  createUser,
  updateCommonCTokenStats,
  exponentToBigDecimal,
  cTokenDecimalsBD,
} from './helpers'

/*  User supplies assets into market and receives cTokens in exchange
 *  Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.mintAmount is the underlying asset
 *  event.mintTokens is the amount of cTokens minted
 *  event.minter is the user
 *  note - mints  originate from the cToken address, not 0x000000, which is typical of ERC-20s
 */
export function handleMint(event: Mint): void {
  let market = updateMarket(event.address, event.block.number.toI32())
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
  }

  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    market.id,
    market.symbol,
    userID,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  cTokenStats.cTokenBalance = cTokenStats.cTokenBalance
    .plus(event.params.mintTokens.toBigDecimal().div(cTokenDecimalsBD))
    .truncate(market.underlyingDecimals)

  // Get updated realized balance with the updated market exchange rate
  cTokenStats.realizedLendBalance = market.exchangeRate
    .times(cTokenStats.cTokenBalance)
    .truncate(market.underlyingDecimals)

  cTokenStats.totalUnderlyingSupplied = cTokenStats.totalUnderlyingSupplied
    .plus(
      event.params.mintAmount
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals)),
    )
    .truncate(market.underlyingDecimals)

  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  cTokenStats.save()

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
  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    market.id,
    market.symbol,
    userID,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  cTokenStats.cTokenBalance = cTokenStats.cTokenBalance
    .minus(event.params.redeemTokens.toBigDecimal().div(cTokenDecimalsBD))
    .truncate(market.underlyingDecimals)

  // Get updated realized balance with the updated market exchange rate
  cTokenStats.realizedLendBalance = market.exchangeRate
    .times(cTokenStats.cTokenBalance)
    .truncate(market.underlyingDecimals)

  cTokenStats.totalUnderlyingRedeemed = cTokenStats.totalUnderlyingRedeemed
    .plus(
      event.params.redeemAmount
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals)),
    )
    .truncate(market.underlyingDecimals)

  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
  }
  // if (user.hasBorrowed == true) {
  //   calculateLiquidty(userID)
  // }
}

/* Borrow assets from the protocol. All values either ETH or ERC20
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 */
export function handleBorrow(event: Borrow): void {
  let market = updateMarket(event.address, event.block.number.toI32())
  let userID = event.params.borrower.toHex()
  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    market.id,
    market.symbol,
    userID,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  let borrowAmountBD = event.params.borrowAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
  let previousBorrowBalanceWithInterest: BigDecimal

  if (cTokenStats.realizedBorrowBalance == BigDecimal.fromString('0')) {
    previousBorrowBalanceWithInterest = BigDecimal.fromString('0')
  } else {
    previousBorrowBalanceWithInterest = cTokenStats.realizedBorrowBalance
      .times(market.borrowIndex)
      .div(cTokenStats.userBorrowIndex)
      .truncate(market.underlyingDecimals)
  }

  cTokenStats.realizedBorrowBalance = previousBorrowBalanceWithInterest.plus(
    borrowAmountBD,
  )

  cTokenStats.userBorrowIndex = market.borrowIndex

  cTokenStats.totalUnderlyingBorrowed = cTokenStats.totalUnderlyingBorrowed.plus(
    borrowAmountBD,
  )

  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    user = createUser(userID)
  }
  user.hasBorrowed = true
  user.save()
  calculateLiquidty(userID)
}

// TODO - what happens when someone pays off their full borrow? their index should reset, but does it?
// their principal borrowed for sure becomes 0

/* Repay some amount borrowed. Anyone can repay anyones balance
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  let market = updateMarket(event.address, event.block.number.toI32())
  let userID = event.params.borrower.toHex()
  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    market.id,
    market.symbol,
    userID,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  let repayAmountBD = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
  let previousBorrowBalanceWithInterest: BigDecimal

  if (cTokenStats.realizedBorrowBalance == BigDecimal.fromString('0')) {
    previousBorrowBalanceWithInterest = BigDecimal.fromString('0')
  } else {
    previousBorrowBalanceWithInterest = cTokenStats.realizedBorrowBalance
      .times(market.borrowIndex)
      .div(cTokenStats.userBorrowIndex)
      .truncate(market.underlyingDecimals)
  }

  cTokenStats.realizedBorrowBalance = previousBorrowBalanceWithInterest.minus(
    repayAmountBD,
  )

  cTokenStats.userBorrowIndex = market.borrowIndex

  cTokenStats.totalUnderlyingRepaid = cTokenStats.totalUnderlyingRepaid.plus(
    repayAmountBD,
  )

  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
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

  let liquidatorID = event.params.liquidator.toHex()
  let liquidator = User.load(liquidatorID)
  if (liquidator == null) {
    liquidator = createUser(liquidatorID)
  }
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrowerID = event.params.borrower.toHex()
  let borrower = User.load(borrowerID)
  if (borrower == null) {
    borrower = createUser(borrowerID)
  }
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()
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
  let userFromID = event.params.from.toHex()
  // TODO - hmm, this seems impossible to happen, should i still keep it? i remember an edge case liek this from the past
  let userFrom = User.load(userFromID)
  if (userFrom == null) {
    createUser(userFromID)
    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    let cTokenStatsFrom = updateCommonCTokenStats(
      market.id,
      market.symbol,
      userFromID,
      event.transaction.hash,
      event.block.timestamp.toI32(),
      event.block.number.toI32(),
    )

    let amountWithDecimals = event.params.amount
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
    let amountUnderlying = market.exchangeRate
      .times(amountWithDecimals)
      .truncate(market.underlyingDecimals)

    cTokenStatsFrom.cTokenBalance = cTokenStatsFrom.cTokenBalance
      .minus(event.params.amount.toBigDecimal())
      .div(cTokenDecimalsBD)
      .truncate(market.underlyingDecimals)

    // Get updated realized balance with the updated market exchange rate
    // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
    cTokenStatsFrom.realizedLendBalance = market.exchangeRate.times(
      cTokenStatsFrom.cTokenBalance.truncate(market.underlyingDecimals),
    )

    cTokenStatsFrom.totalUnderlyingRedeemed = cTokenStatsFrom.totalUnderlyingRedeemed.plus(
      amountUnderlying,
    )
    cTokenStatsFrom.realizedSupplyInterest = cTokenStatsFrom.realizedLendBalance
      .minus(cTokenStatsFrom.totalUnderlyingSupplied)
      .plus(cTokenStatsFrom.totalUnderlyingRedeemed)
      .minus(amountUnderlying)

    cTokenStatsFrom.save()

    /********** User To Updates Below **********/
    // We do the same for userTo as userFrom, but check if user and cTokenStats entities are null
    let userToID = event.params.to.toHex()
    let userTo = User.load(userToID)
    if (userTo == null) {
      createUser(userToID)
    }
    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    let cTokenStatsTo = updateCommonCTokenStats(
      market.id,
      market.symbol,
      userToID,
      event.transaction.hash,
      event.block.timestamp.toI32(),
      event.block.number.toI32(),
    )

    cTokenStatsTo.cTokenBalance = cTokenStatsTo.cTokenBalance
      .plus(event.params.amount.toBigDecimal())
      .div(cTokenDecimalsBD)
      .truncate(market.underlyingDecimals)

    // Get updated realized balance with the updated market exchange rate
    // TODO, do I need to divide by mantissa 10^18 because of exchange rate? I do NOT believe so. Will confirm upon syncing
    cTokenStatsFrom.realizedLendBalance = market.exchangeRate.times(
      cTokenStatsFrom.cTokenBalance.truncate(market.underlyingDecimals),
    )

    cTokenStatsTo.totalUnderlyingSupplied = cTokenStatsTo.totalUnderlyingSupplied.plus(
      amountUnderlying,
    )
    cTokenStatsTo.realizedSupplyInterest = cTokenStatsTo.realizedLendBalance
      .minus(cTokenStatsTo.totalUnderlyingSupplied)
      .plus(cTokenStatsTo.totalUnderlyingRedeemed)
      .minus(amountUnderlying)

    cTokenStatsTo.save()
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

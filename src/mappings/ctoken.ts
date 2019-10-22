/* eslint-disable prefer-const */ // to satisfy AS compiler
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
import { CTokenInfo, Market, User } from '../types/schema'

import { updateMarket } from './markets'
import {
  createUser,
  updateCommonCTokenStats,
  exponentToBigDecimal,
  cTokenDecimalsBD,
  createCTokenInfo,
} from './helpers'

//TODO handle transfers from the cBAT accounts. They should not have negative balances
// TODO - ctokenStats is not a good name. It involves borrowing and ctokens. Borrowing is only
//  underlying assets. marketStats is more accurate. but still, it needs to match compounds api

/*  User supplies assets into market and receives cTokens in exchange
 *  Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.mintAmount is the underlying asset
 *  event.mintTokens is the amount of cTokens minted
 *  event.minter is the user
 *  note - mints  originate from the cToken address, not 0x000000, which is typical of ERC-20s
 */
export function handleMint(event: Mint): void {
  // No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
  let market = Market.load(event.address.toHexString())
  // let market = updateMarket(event.address, event.block.number.toI32())
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
  }

  let cTokenStatsID = market.id.concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(cTokenStatsID, market.symbol, userID, market.id)
  }

  // Not needed, transfer will update this
  // let cTokenStats = updateCommonCTokenStats(
  //   market.id,
  //   market.symbol,
  //   userID,
  //   event.transaction.hash,
  //   event.block.timestamp.toI32(),
  //   event.block.number.toI32(),
  // )

  // cTokenStats.cTokenBalance = cTokenStats.cTokenBalance
  //   .plus(event.params.mintTokens.toBigDecimal().div(cTokenDecimalsBD))
  //   .truncate(market.underlyingDecimals)

  cTokenStats.totalUnderlyingSupplied = cTokenStats.totalUnderlyingSupplied
    .plus(
      event.params.mintAmount
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals)),
    )
    .truncate(market.underlyingDecimals)

  cTokenStats.save()
}

/*  User supplies cTokens into market and receives underlying asset in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the user
 */
export function handleRedeem(event: Redeem): void {
  // No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
  let market = Market.load(event.address.toHexString())
  // let market = updateMarket(event.address, event.block.number.toI32())
  let userID = event.params.redeemer.toHex()

  let cTokenStatsID = market.id.concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(cTokenStatsID, market.symbol, userID, market.id)
  }

  // Not needed, transfer will update this
  // let cTokenStats = updateCommonCTokenStats(
  //   market.id,
  //   market.symbol,
  //   userID,
  //   event.transaction.hash,
  //   event.block.timestamp.toI32(),
  //   event.block.number.toI32(),
  // )

  // cTokenStats.cTokenBalance = cTokenStats.cTokenBalance
  //   .minus(event.params.redeemTokens.toBigDecimal().div(cTokenDecimalsBD))
  //   .truncate(market.underlyingDecimals)

  cTokenStats.totalUnderlyingRedeemed = cTokenStats.totalUnderlyingRedeemed
    .plus(
      event.params.redeemAmount
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals)),
    )
    .truncate(market.underlyingDecimals)

  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
  }
}

/* Borrow assets from the protocol. All values either ETH or ERC20
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 */
export function handleBorrow(event: Borrow): void {
  // No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
  let market = Market.load(event.address.toHexString())
  // let market = updateMarket(event.address, event.block.number.toI32())
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
  cTokenStats.storedBorrowBalance = event.params.accountBorrows.toBigDecimal()
  cTokenStats.userBorrowIndex = market.borrowIndex
  cTokenStats.totalUnderlyingBorrowed = cTokenStats.totalUnderlyingBorrowed.plus(
    borrowAmountBD,
  )
  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    user = createUser(userID)
  }
  user.hasBorrowed = true
  user.save()
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
  // No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
  let market = Market.load(event.address.toHexString())
  // let market = updateMarket(event.address, event.block.number.toI32())
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
  cTokenStats.storedBorrowBalance = event.params.accountBorrows.toBigDecimal()
  cTokenStats.userBorrowIndex = market.borrowIndex
  cTokenStats.totalUnderlyingRepaid = cTokenStats.totalUnderlyingRepaid.plus(
    repayAmountBD,
  )
  cTokenStats.save()

  let user = User.load(userID)
  if (user == null) {
    createUser(userID)
  }
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
  // No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
  // updateMarket(event.address, event.block.number.toI32())
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
 *    seize() - i.e. a Liquidation Transfer (does not emit anything else)
 *    redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *    mintFresh() - i.e. you are lending underlying assets to create ctokens
 *    transfer() - i.e. a basic transfer
 * This function handles all 4 cases, since duplicate data is emitted in the transfer event, as well
 * as the mint, redeem, and seize events. So for those events, we do not update cToken balances.
 *
 * event.params.from = sender of cTokens
 * event.params.to = receiver of cTokens
 * event.params.amount = amount sent
 */

// TODO - we arrre going to get duplicate tx hashes and tx times now, cuz of the duplicate events . prob just remove it from mint and redeem etc.
export function handleTransfer(event: Transfer): void {
  // We only updateMarket() if accrual block number is not up to date. This will only happen
  // with normal transfers, since mint, redeem, and seize transfers will already run updateMarket()
  let market = Market.load(event.address.toHexString())
  if (market.accrualBlockNumber != event.block.number.toI32()) {
    market = updateMarket(event.address, event.block.number.toI32())
  }

  // User From
  let userFromID = event.params.from.toHex()
  let userFrom = User.load(userFromID)
  if (userFrom == null) {
    createUser(userFromID)
  }
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

  cTokenStatsFrom.totalUnderlyingRedeemed = cTokenStatsFrom.totalUnderlyingRedeemed.plus(
    amountUnderlying,
  )
  cTokenStatsFrom.save()

  // User To
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

  cTokenStatsTo.totalUnderlyingSupplied = cTokenStatsTo.totalUnderlyingSupplied.plus(
    amountUnderlying,
  )
  cTokenStatsTo.save()
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

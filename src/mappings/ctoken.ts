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
  NewMarketInterestRateModel,
} from '../types/cREP/CToken'
import { CTokenInfo, Market, User } from '../types/schema'

import { createMarket, updateMarket } from './markets'
import {
  createUser,
  updateCommonCTokenStats,
  exponentToBigDecimal,
  cTokenDecimalsBD,
  cTokenDecimals,
  createCTokenInfo,
  zeroBD,
} from './helpers'

/* TODO
 * - ctokenStats is not a good name. It involves borrowing and ctokens. Borrowing is only
 * underlying assets. marketStats is more accurate. but still, it needs to match compounds api
 */

/* User supplies assets into market and receives cTokens in exchange
 *
 * event.mintAmount is the underlying asset
 * event.mintTokens is the amount of cTokens minted
 * event.minter is the user
 *
 * Notes
 *    Transfer event will always get emitted with this
 *    Mints originate from the cToken address, not 0x000000, which is typical of ERC-20s
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
export function handleMint(event: Mint): void {
  let market = Market.load(event.address.toHexString())
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
 *
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the user
 *
 *  Notes
 *    Transfer event will always get emitted with this
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
export function handleRedeem(event: Redeem): void {
  let market = Market.load(event.address.toHexString())
  let userID = event.params.redeemer.toHex()
  let cTokenStatsID = market.id.concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createCTokenInfo(cTokenStatsID, market.symbol, userID, market.id)
  }

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
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 */
export function handleBorrow(event: Borrow): void {
  let market = Market.load(event.address.toHexString())
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
  let previousBorrow = cTokenStats.storedBorrowBalance

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

  if (
    previousBorrow.equals(zeroBD) &&
    !event.params.accountBorrows.toBigDecimal().equals(zeroBD) // checking edge case for borrwing 0
  ) {
    market.numberOfBorrowers = market.numberOfBorrowers + 1
    market.save()
  }
}

// TODO - what happens when someone pays off their full borrow? their index should reset, but does it?
// their principal borrowed for sure becomes 0

/* Repay some amount borrowed. Anyone can repay anyones balance
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  let market = Market.load(event.address.toHexString())
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

  if (cTokenStats.storedBorrowBalance.equals(zeroBD)) {
    market.numberOfBorrowers = market.numberOfBorrowers - 1
    market.save()
  }
}

/*
 * Liquidate a user who has fell below the collateral factor.
 *
 * event.params.borrower - the borrower who is getting liquidated of their cTokens
 * event.params.cTokenCollateral - the market ADDRESS of the ctoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - cTokens seized (transfer event should handle this)
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this.
 *    When calling this function, event RepayBorrow, and event Transfer will be called every
 *    time. This means we can ignore repayAmount. Seize tokens only changes state
 *    of the cTokens, which is covered by transfer. Therefore we only
 *    add liquidation counts in this handler.
 */
export function handleLiquidateBorrow(event: LiquidateBorrow): void {
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

/* Transferring of cTokens
 *
 * event.params.from = sender of cTokens
 * event.params.to = receiver of cTokens
 * event.params.amount = amount sent
 *
 * Notes
 *    Possible ways to emit Transfer:
 *      seize() - i.e. a Liquidation Transfer (does not emit anything else)
 *      redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *      mintFresh() - i.e. you are lending underlying assets to create ctokens
 *      transfer() - i.e. a basic transfer
 *    This function handles all 4 cases. Transfer is emitted alongside the mint, redeem, and seize
 *    events. So for those events, we do not update cToken balances.
 */
export function handleTransfer(event: Transfer): void {
  // We only updateMarket() if accrual block number is not up to date. This will only happen
  // with normal transfers, since mint, redeem, and seize transfers will already run updateMarket()
  let marketID = event.address.toHexString()
  let market = Market.load(marketID)
  if (market.accrualBlockNumber != event.block.number.toI32()) {
    market = updateMarket(
      event.address,
      event.block.number.toI32(),
      event.block.timestamp.toI32(),
    )
  }

  let amountWithDecimals = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
  let amountUnderlying = market.exchangeRate
    .times(amountWithDecimals)
    .truncate(market.underlyingDecimals)

  let userFromID = event.params.from.toHex()

  // Checking if the tx is FROM the cToken contract
  // If so, it is a mint, and we don't need to run these calculations
  if (userFromID != marketID) {
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

    cTokenStatsFrom.cTokenBalance = cTokenStatsFrom.cTokenBalance.minus(
      event.params.amount
        .toBigDecimal()
        .div(cTokenDecimalsBD)
        .truncate(cTokenDecimals),
    )

    cTokenStatsFrom.totalUnderlyingRedeemed = cTokenStatsFrom.totalUnderlyingRedeemed.plus(
      amountUnderlying,
    )
    cTokenStatsFrom.save()

    if (cTokenStatsFrom.cTokenBalance.equals(zeroBD)) {
      market.numberOfSuppliers = market.numberOfSuppliers - 1
      market.save()
    }
  }

  let userToID = event.params.to.toHex()
  // Checking if the tx is FROM the cToken contract
  // If so, we ignore it. this leaves an edge case, where someone who accidentally sends
  // cTokens to a cToken contract, where it will not get recorded. Right now it would
  // be messy to include, so we are leaving it out for now TODO fix this in future
  if (userToID != marketID) {
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

    let previousCTokenBalanceTo = cTokenStatsTo.cTokenBalance
    cTokenStatsTo.cTokenBalance = cTokenStatsTo.cTokenBalance.plus(
      event.params.amount
        .toBigDecimal()
        .div(cTokenDecimalsBD)
        .truncate(cTokenDecimals),
    )

    cTokenStatsTo.totalUnderlyingSupplied = cTokenStatsTo.totalUnderlyingSupplied.plus(
      amountUnderlying,
    )
    cTokenStatsTo.save()

    if (
      previousCTokenBalanceTo.equals(zeroBD) &&
      !event.params.amount.toBigDecimal().equals(zeroBD) // checking edge case for transfers of 0
    ) {
      market.numberOfSuppliers = market.numberOfSuppliers + 1
      market.save()
    }
  }
}

export function handleAccrueInterest(event: AccrueInterest): void {
  updateMarket(event.address, event.block.number.toI32(), event.block.timestamp.toI32())
}

export function handleNewReserveFactor(event: NewReserveFactor): void {
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  market.reserveFactor = event.params.newReserveFactorMantissa
  market.save()
}

export function handleNewMarketInterestRateModel(
  event: NewMarketInterestRateModel,
): void {
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }
  market.interestRateModelAddress = event.params.newInterestRateModel
  market.save()
}

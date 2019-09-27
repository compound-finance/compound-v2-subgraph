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
  updateMarket(event.address, event.block.number.toI32())

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
    let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
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

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let cTokenContract = CToken.bind(event.address)
  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just take market.exchangeRate x cToken balance. NOTE - you will have to move it below the other contract call in here 
  let underlyingBalance = cTokenContract.call('balanceOfUnderlying', [
    EthereumValue.fromAddress(event.params.minter),
  ])
  cTokenStats.realizedLendBalance = underlyingBalance[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))
  cTokenStats.totalUnderlyingSupplied = cTokenStats.totalUnderlyingSupplied.plus(
    event.params.mintAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )

  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just ADD the previous, plus this value
  cTokenStats.cTokenBalance = cTokenContract
    .balanceOf(event.params.minter)
    .toBigDecimal()
    .div(BigDecimal.fromString('100000000'))
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
  updateMarket(event.address, event.block.number.toI32())

  let userID = event.params.redeemer.toHex()
  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  if (cTokenStats == null) {
    let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
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

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let cTokenContract = CToken.bind(event.address)
  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just take market.exchangeRate x cToken balance. NOTE - you will have to move it below the other contract call in here 
  let underlyingBalance = cTokenContract.call('balanceOfUnderlying', [
    EthereumValue.fromAddress(event.params.redeemer),
  ])
  cTokenStats.realizedLendBalance = underlyingBalance[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))

  cTokenStats.totalUnderlyingRedeemed = cTokenStats.totalUnderlyingRedeemed.plus(
    event.params.redeemAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedSupplyInterest = cTokenStats.realizedLendBalance
    .minus(cTokenStats.totalUnderlyingSupplied)
    .plus(cTokenStats.totalUnderlyingRedeemed)

  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just ADD the previous, plus this value
  cTokenStats.cTokenBalance = cTokenContract
    .balanceOf(event.params.redeemer)
    .toBigDecimal()
    .div(BigDecimal.fromString('100000000'))
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
  updateMarket(event.address, event.block.number.toI32())

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let cTokenStatsID = event.address
    .toHexString()
    .concat('-')
    .concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  // this is needed, since you could lend in one asset and borrow in another
  if (cTokenStats == null) {
    let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
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

  let cTokenContract = CToken.bind(event.address)

  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just take borrowBalance * borrowIndexLatest / userBorrowIndex
  // NOTE - you will have to move it below the other contract call in here 
  let borrowBalance = cTokenContract.call('borrowBalanceCurrent', [
    EthereumValue.fromAddress(event.params.borrower),
  ])
  cTokenStats.realizedBorrowBalance = borrowBalance[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))
  cTokenStats.totalUnderlyingBorrowed = cTokenStats.totalUnderlyingBorrowed.plus(
    event.params.borrowAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  // TODO - remove this, cTkenBalance is not changed at all in borrowing
  // cTokenStats.cTokenBalance = cTokenContract
  //   .balanceOf(event.params.borrower)
  //   .toBigDecimal()
  //   .div(BigDecimal.fromString('100000000'))
  // cTokenStats.save()

  let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
  cTokenStats.userBorrowIndex = market.borrowIndex

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
  updateMarket(event.address, event.block.number.toI32())

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

  let cTokenContract = CToken.bind(event.address)
  // TODO - OPTIMIZE OUT THIS CONTRACT CALL, just take borrowBalance * borrowIndexLatest / userBorrowIndex
  // NOTE - you will have to move it below the other contract call in here 
  let borrowBalance = cTokenContract.call('borrowBalanceCurrent', [
    EthereumValue.fromAddress(event.params.borrower),
  ])
  cTokenStats.realizedBorrowBalance = borrowBalance[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000')
    )
  cTokenStats.totalUnderlyingRepaid = cTokenStats.totalUnderlyingRepaid.plus(
    event.params.repayAmount
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
  )
  cTokenStats.realizedBorrowInterest = cTokenStats.realizedBorrowBalance
    .minus(cTokenStats.totalUnderlyingBorrowed)
    .plus(cTokenStats.totalUnderlyingRepaid)

  // TODO - remove this, cTkenBalance is not changed at all in borrowing
  // cTokenStats.cTokenBalance = cTokenContract
  //   .balanceOf(event.params.borrower)
  //   .toBigDecimal()
  //   .div(BigDecimal.fromString('100000000'))
  // cTokenStats.save()

  let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
  cTokenStats.userBorrowIndex = market.borrowIndex

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
// TODO - optimize this funciton, it makes SO many contract calls
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
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let cTokenContract = CToken.bind(event.address)

  // Since transfer does not effect any coins or cTokens, it just transfers cTokens, we only update
  // market values that are dependant on the block delta
  // TODO - this is wrong, other values ar then derived from these four values, such as totalBorrows. fix
  market.borrowIndex = cTokenContract.borrowIndex().toBigDecimal()

  // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
  market.perBlockBorrowInterest = cTokenContract
    .borrowRatePerBlock()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))
  market.perBlockSupplyInterest = cTokenContract
    .supplyRatePerBlock()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))

  market.save()

  // Calculate the exchange rate and amount of underlying being transferred
  let exchangeRate = cTokenContract
    .exchangeRateStored()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))
  let amountUnderlying = exchangeRate.times(event.params.amount.toBigDecimal())

  // TODO DK TODAY - the two above was only in CERC20, not CETH,
  // need to make sure this doesnt break it

  let cTokenStatsFromID = market.id.concat('-').concat(event.params.from.toHex())
  let cTokenStatsFrom = CTokenInfo.load(cTokenStatsFromID)

  let txHashesFrom = cTokenStatsFrom.transactionHashes
  txHashesFrom.push(event.transaction.hash)
  cTokenStatsFrom.transactionHashes = txHashesFrom
  let txTimesFrom = cTokenStatsFrom.transactionTimes
  txTimesFrom.push(event.block.timestamp.toI32())
  cTokenStatsFrom.transactionTimes = txTimesFrom
  cTokenStatsFrom.accrualBlockNumber = event.block.number

  // TODO - Optimize, just minus the tokens 
  let accountSnapshotFrom = cTokenContract.getAccountSnapshot(event.params.from)
  cTokenStatsFrom.cTokenBalance = accountSnapshotFrom.value1
    .toBigDecimal()
    .div(BigDecimal.fromString('100000000')
  )

  
  // TODO - Optimize, just multiply with markets new exchange rate
  let underlyingBalanceFrom = cTokenContract.call('balanceOfUnderlying', [
    EthereumValue.fromAddress(event.params.from),
  ])
  cTokenStatsFrom.realizedLendBalance = underlyingBalanceFrom[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))
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
    let market = Market.load(event.address.toHexString()) // TODO, if we return market from updateMarket, this could be one less load
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

  // TODO - Optimize, just add the tokens 
  let accountSnapshotTo = cTokenContract.getAccountSnapshot(event.params.to)
  cTokenStatsTo.cTokenBalance = accountSnapshotTo.value1
    .toBigDecimal()
    .div(BigDecimal.fromString('100000000'))

  // TODO - Optimize, just multiply with markets new exchange rate
  let underlyingBalanceTo = cTokenContract.call('balanceOfUnderlying', [
    EthereumValue.fromAddress(event.params.to),
  ])
  cTokenStatsTo.realizedLendBalance = underlyingBalanceTo[0]
    .toBigInt()
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'))

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

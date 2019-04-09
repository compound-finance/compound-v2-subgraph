import {BigInt, EthereumValue} from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  CEther,
} from '../types/cETH/CEther'

import {
  Market,
  User,
  UserAsset,
} from '../types/schema'

/*  User supplies assets into market and receives cTokens in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.mintAmount is the underlying asset
 *  event.mintTokens is the amount of cTokens minted
 *  event.minter is the user
 *  note - mints  originate from the cToken address, not 0x000000, which is typical of ERC-20s
 */
export function handleMint(event: Mint): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CEther.bind(event.address)
  if (market == null) {
    market = new Market(marketID)
    market.symbol = contract.symbol()
  }

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply()
  market.exchangeRate = contract.exchangeRateStored() // can't call, exchangeRateCurrent(), costs gas
  market.totalReserves = contract.totalReserves()
  market.totalBorrows = contract.totalBorrows()
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  // TODO - Either Compound makes ether cash a public function we can call, or graph software has to read ether balances
  // let erc20TokenContract = CEther.bind(contract.underlying())
  // let cash = erc20TokenContract.balanceOf(event.address)
  // market.totalCash = cash
  // // deposits = cash + borrows - reserves
  // market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)
  market.save()

  /********** User Below **********/

  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.assets = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.save()
  }

  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)
  if (userAsset == null) {
    userAsset = new UserAsset(userAssetID)
    userAsset.user = event.params.minter
    userAsset.transactionHashes = []
    userAsset.transactionTimes = []
    userAsset.underlyingSupplied = BigInt.fromI32(0)
    userAsset.underlyingRedeemed = BigInt.fromI32(0)
    userAsset.underlyingBalance = BigInt.fromI32(0)
    userAsset.interestEarned = BigInt.fromI32(0)
    userAsset.cTokenBalance = BigInt.fromI32(0)
    userAsset.totalBorrowed = BigInt.fromI32(0)
    userAsset.totalRepaid = BigInt.fromI32(0)
    userAsset.borrowBalance = BigInt.fromI32(0)
    userAsset.borrowInterest = BigInt.fromI32(0)
  }

  let txHashes = userAsset.transactionHashes
  txHashes.push(event.transaction.hash)
  userAsset.transactionHashes = txHashes
  let txTimes = userAsset.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  userAsset.transactionTimes = txTimes
  userAsset.accrualBlockNumber = event.block.number

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let underlyingBalance = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.minter)])
  userAsset.underlyingBalance = underlyingBalance[0].toBigInt()
  userAsset.underlyingSupplied = userAsset.underlyingSupplied.plus(event.params.mintAmount)
  userAsset.interestEarned = userAsset.underlyingBalance.minus(userAsset.underlyingSupplied).plus(userAsset.underlyingRedeemed)
  userAsset.save()
}


/*  User supplies cTokens into market and receives underlying asset in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the user
 */
export function handleRedeem(event: Redeem): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CEther.bind(event.address)

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply()
  market.exchangeRate = contract.exchangeRateStored() // can't call, exchangeRateCurrent(), costs gas
  market.totalReserves = contract.totalReserves()
  market.totalBorrows = contract.totalBorrows()
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  // TODO - Either Compound makes ether cash a public function we can call, or graph software has to read ether balances
  // let erc20TokenContract = CEther.bind(contract.underlying())
  // let cash = erc20TokenContract.balanceOf(event.address)
  // market.totalCash = cash
  // //  deposits = cash + borrows - reserves
  // market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)
  market.save()

  let userID = event.params.redeemer.toHex()
  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)

  /********** User Updates Below **********/ //
  let txHashes = userAsset.transactionHashes
  txHashes.push(event.transaction.hash)
  userAsset.transactionHashes = txHashes
  let txTimes = userAsset.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  userAsset.transactionTimes = txTimes
  userAsset.accrualBlockNumber = event.block.number

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let underlyingBalance = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.redeemer)])

  // TODO - sometimes this in negative. could be rounding errors from EVM. its always at least 10 decimals. investigate
  userAsset.underlyingBalance = underlyingBalance[0].toBigInt()
  userAsset.underlyingRedeemed = userAsset.underlyingRedeemed.plus(event.params.redeemAmount)
  userAsset.interestEarned = userAsset.underlyingBalance.minus(userAsset.underlyingSupplied).plus(userAsset.underlyingRedeemed)
  userAsset.save()
}

/* Borrow assets from the protocol
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 */
export function handleBorrow(event: Borrow): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CEther.bind(event.address)

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply()
  market.exchangeRate = contract.exchangeRateStored()
  market.totalReserves = contract.totalReserves()
  market.totalBorrows = contract.totalBorrows()
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  // TODO - Either Compound makes ether cash a public function we can call, or graph software has to read ether balances
  // let erc20TokenContract = CEther.bind(contract.underlying())
  // let cash = erc20TokenContract.balanceOf(event.address)
  // market.totalCash = cash
  // market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)
  market.save()

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)

  // this is needed, since you could lend in one asset and borrow in another
  if (userAsset == null) {
    userAsset = new UserAsset(userAssetID)
    userAsset.user = event.params.borrower
    userAsset.transactionHashes = []
    userAsset.transactionTimes = []

    userAsset.underlyingSupplied = BigInt.fromI32(0)
    userAsset.underlyingRedeemed = BigInt.fromI32(0)
    userAsset.underlyingBalance = BigInt.fromI32(0)
    userAsset.interestEarned = BigInt.fromI32(0)
    userAsset.cTokenBalance = BigInt.fromI32(0)

    userAsset.totalBorrowed = BigInt.fromI32(0)
    userAsset.totalRepaid = BigInt.fromI32(0)
    userAsset.borrowBalance = BigInt.fromI32(0)
    userAsset.borrowInterest = BigInt.fromI32(0)
  }

  let txHashes = userAsset.transactionHashes
  txHashes.push(event.transaction.hash)
  userAsset.transactionHashes = txHashes
  let txTimes = userAsset.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  userAsset.transactionTimes = txTimes
  userAsset.accrualBlockNumber = event.block.number

  let borrowBalance = contract.call('borrowBalanceCurrent', [EthereumValue.fromAddress(event.params.borrower)])
  userAsset.borrowBalance = borrowBalance[0].toBigInt()
  userAsset.totalBorrowed = userAsset.totalBorrowed.plus(event.params.borrowAmount)
  userAsset.borrowInterest = userAsset.borrowBalance.minus(userAsset.totalBorrowed).plus(userAsset.totalRepaid)
  userAsset.save()
}

/* Repay some amount borrowed. Anyone can repay anyones balance
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CEther.bind(event.address)

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply()
  market.exchangeRate = contract.exchangeRateStored()
  market.totalReserves = contract.totalReserves()
  market.totalBorrows = contract.totalBorrows()
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  // TODO - Either Compound makes ether cash a public function we can call, or graph software has to read ether balances
  // let erc20TokenContract = CEther.bind(contract.underlying())
  // let cash = erc20TokenContract.balanceOf(event.address)
  // market.totalCash = cash
  // market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)
  market.save()

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)

  let txHashes = userAsset.transactionHashes
  txHashes.push(event.transaction.hash)
  userAsset.transactionHashes = txHashes
  let txTimes = userAsset.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  userAsset.transactionTimes = txTimes
  userAsset.accrualBlockNumber = event.block.number

  let borrowBalance = contract.call('borrowBalanceCurrent', [EthereumValue.fromAddress(event.params.borrower)])
  userAsset.borrowBalance = borrowBalance[0].toBigInt()
  userAsset.totalRepaid = userAsset.totalRepaid.plus(event.params.repayAmount)
  userAsset.borrowInterest = userAsset.borrowBalance.minus(userAsset.totalBorrowed).plus(userAsset.totalRepaid)
  userAsset.save()
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
  let liquidatorID = event.params.liquidator.toHex()
  let liquidator = User.load(liquidatorID)
  if (liquidator == null) {
    liquidator = new User(liquidatorID)
    liquidator.countLiquidated = 0
    liquidator.countLiquidator = 0
    liquidator.assets = []
    liquidator.save()
  }
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrowerID = event.params.borrower.toHex()
  let borrower = User.load(borrowerID)
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()
}

/* Possible ways to emit Transfer:
 *    seize() - i.e. a Liquidation Transfer
 *    redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *    mintFresh() - i.e. you are lending underlying assets to create ctokens
 *    transfer() - i.e. a basic transfer
 * This function must handle all 4 cases, since duplicate data is emitted in the back-to-back transfer
 * The simplest way to do this is call getAccountSnapshot, in here, and leave out any cTokenBalance
 * calculations in the other function. This way we never add or subtract and deviate from the true
 * value store in the smart contract
 */
export function handleTransfer(event: Transfer): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CEther.bind(event.address)

  // Since transfer does not effect any coins or cTokens, it just transfers cTokens, we only update
  // market values that are dependant on the block delta
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()
  market.save()

  /********** User From Updates Below **********/
  let userAssetFromID = market.symbol.concat('-').concat(event.params.from.toHex())
  let userAssetFrom = UserAsset.load(userAssetFromID)

  let txHashesFrom = userAssetFrom.transactionHashes
  txHashesFrom.push(event.transaction.hash)
  userAssetFrom.transactionHashes = txHashesFrom
  let txTimesFrom = userAssetFrom.transactionTimes
  txTimesFrom.push(event.block.timestamp.toI32())
  userAssetFrom.transactionTimes = txTimesFrom
  userAssetFrom.accrualBlockNumber = event.block.number


  let accountSnapshotFrom = contract.getAccountSnapshot(event.params.from)
  userAssetFrom.cTokenBalance = accountSnapshotFrom.value1
  userAssetFrom.borrowBalance = accountSnapshotFrom.value2 // might as well update this, as it depends on block number

  let underlyingBalanceFrom = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.from)])
  userAssetFrom.underlyingBalance = underlyingBalanceFrom[0].toBigInt()
  userAssetFrom.interestEarned = userAssetFrom.underlyingBalance.minus(userAssetFrom.underlyingSupplied).plus(userAssetFrom.underlyingRedeemed)
  userAssetFrom.save()

  /********** User To Updates Below **********/
    // We do the same for userTo as we did for userFrom, but check if user and userAsset entities are null
  let userToID = event.params.to.toHex()
  let userTo = User.load(userToID)
  if (userTo == null) {
    userTo = new User(userToID)
    userTo.assets = []
    userTo.countLiquidated = 0
    userTo.countLiquidator = 0
    userTo.save()
  }

  let userAssetToID = market.symbol.concat('-').concat(userToID)
  let userAssetTo = UserAsset.load(userAssetToID)
  if (userAssetTo == null) {
    userAssetTo = new UserAsset(userToID)
    userAssetTo.user = event.params.to
    userAssetTo.transactionHashes = []
    userAssetTo.transactionTimes = []
    userAssetTo.underlyingSupplied = BigInt.fromI32(0)
    userAssetTo.underlyingRedeemed = BigInt.fromI32(0)
    userAssetTo.underlyingBalance = BigInt.fromI32(0)
    userAssetTo.interestEarned = BigInt.fromI32(0)
    userAssetTo.cTokenBalance = BigInt.fromI32(0)
    userAssetTo.totalBorrowed = BigInt.fromI32(0)
    userAssetTo.totalRepaid = BigInt.fromI32(0)
    userAssetTo.borrowBalance = BigInt.fromI32(0)
    userAssetTo.borrowInterest = BigInt.fromI32(0)
  }

  let txHashesTo = userAssetTo.transactionHashes
  txHashesTo.push(event.transaction.hash)
  userAssetTo.transactionHashes = txHashesTo
  let txTimesTo = userAssetTo.transactionTimes
  txTimesTo.push(event.block.timestamp.toI32())
  userAssetTo.transactionTimes = txTimesTo
  userAssetTo.accrualBlockNumber = event.block.number

  let accountSnapshotTo = contract.getAccountSnapshot(event.params.to)
  userAssetTo.cTokenBalance = accountSnapshotTo.value1
  userAssetTo.borrowBalance = accountSnapshotTo.value2 // might as well update this

  let underlyingBalanceTo = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.to)])
  userAssetTo.underlyingBalance = underlyingBalanceTo[0].toBigInt()
  userAssetTo.interestEarned = userAssetTo.underlyingBalance.minus(userAssetTo.underlyingSupplied).plus(userAssetTo.underlyingRedeemed)
  userAssetTo.save()
}
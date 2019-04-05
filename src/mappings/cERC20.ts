import {BigInt, EthereumValue} from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  CErc20,
} from '../types/cBAT/CErc20'

import {
  Market,
  User,
  UserAsset,
} from '../types/schema'

// TODO - handle approval? probably not but will double check

/*  User supplies assets into market and receives cTokens in exchange
 *  Note - Transfer event also gets emitted, but some info is duplicate, so must handle so we
 *  don't double down on tokens
 *  event.mintAmount is the underlying asset
 *  event.minttoknes is the ctokens
 *  event.minter is the user
 *  mints actually originate from the ctoken address, not 0x000000
 */
export function handleMint(event: Mint): void {
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.assets = []
    user.save()
  }

  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CErc20.bind(event.address)
  if (market == null) {
    market = new Market(marketID)
    market.symbol = contract.symbol()
  }

  market.accrualBlockNumber = contract.accrualBlockNumber()
  market.totalSupply = contract.totalSupply()
  market.exchangeRate = contract.exchangeRateStored() // this should be okay, but its not live, cant call the exchangeRateCurrent()

  market.totalReserves = contract.totalReserves()
  // seems this is all that is needed for reserves? the other two above vals may replace the old

  market.totalBorrows = contract.totalBorrows()
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()

  // Now we must get the true erc20 balance of the CErc20.sol contract
  // Note we use the CErc20 interface because it is inclusive of ERC20s interface
  // And we don't have access to just ERC20.
  let erc20TokenContract = CErc20.bind(contract.underlying())
  let cash = erc20TokenContract.balanceOf(event.address)
  market.totalCash = cash

  //cash + borrows - reserves = deposits
  market.totalDeposits = market.totalCash.plus(market.totalBorrows).minus(market.totalReserves)

  market.save()

  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)
  if (userAsset == null) {
    userAsset = new UserAsset(userAssetID)
    userAsset.user = event.params.minter
    userAsset.transactionHashes = []
    userAsset.transactionTimes = []

    userAsset.underlyingPrincipal = BigInt.fromI32(0)
    userAsset.underlyingBalance = BigInt.fromI32(0)
    userAsset.underlyingIndex = BigInt.fromI32(0)
    userAsset.cTokenBalance = BigInt.fromI32(0)


    userAsset.borrowPrincipal = BigInt.fromI32(0)
    userAsset.borrowBalance = BigInt.fromI32(0)
    userAsset.borrowIndex = BigInt.fromI32(0)
    userAsset.borrowInterest = BigInt.fromI32(0)
  }

  let txHashes = userAsset.transactionHashes
  txHashes.push(event.transaction.hash)
  userAsset.transactionHashes = txHashes
  let txTimes = userAsset.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  userAsset.transactionTimes = txTimes

  // We ignore this, in favour of always updating cTokens through Transfer event only
  // let accountSnapshot = contract.getAccountSnapshot(event.params.minter)
  // userAsset.cTokenBalance = accountSnapshot.value1
  // userAsset.borrowBalance = accountSnapshot.value2


  userAsset.underlyingPrincipal = userAsset.underlyingPrincipal.plus(event.params.mintAmount)
  // We use low level call here, since the function is not a view function. However, it still works, but gives the stored state of the most recent block update
  let underlyingBalance = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.minter)])
  userAsset.underlyingBalance = underlyingBalance[0].toBigInt()

  // TODO - incorporate BigDecimal
  userAsset.underlyingIndex = userAsset.underlyingBalance.div(userAsset.underlyingPrincipal)
  userAsset.save()
}

export function handleRedeem(event: Redeem): void {

}

export function handleBorrow(event: Borrow): void {

}

export function handleRepayBorrow(event: RepayBorrow): void {

}

export function handleLiquidateBorrow(event: LiquidateBorrow): void {

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
  let userFromAddress = event.params.from

  // We IGNORE updating user balances when transfer is from CErc20 address.
  // this is because event Mint() already did the update, and is always emitted before Transfer
  // if (userFromAddress != event.address){
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CErc20.bind(event.address)

  // Since transfer does not effect any coins or cTokens, it just transfers ctokens, we only update
  // market values that are dependant on the block delta
  market.borrowIndex = contract.borrowIndex()
  market.perBlockBorrowInterest = contract.borrowRatePerBlock()
  market.save()

  // here we update every field except underlyingPrincipal, since it is not dependant on interest rates
  // we update here because the exchange rate stored for this user is likely behind, at least a few blocks
  let userAssetFromID = market.symbol.concat('-').concat(userFromAddress.toHex())
  let userAssetFrom = UserAsset.load(userAssetFromID)

  let txHashesFrom = userAssetFrom.transactionHashes
  txHashesFrom.push(event.transaction.hash)
  userAssetFrom.transactionHashes = txHashesFrom
  let txTimesFrom = userAssetFrom.transactionTimes
  txTimesFrom.push(event.block.timestamp.toI32())
  userAssetFrom.transactionTimes = txTimesFrom

  let accountSnapshotFrom = contract.getAccountSnapshot(event.params.from)
  userAssetFrom.cTokenBalance = accountSnapshotFrom.value1
  userAssetFrom.borrowBalance = accountSnapshotFrom.value2 // might as well update this

  let underlyingBalanceFrom = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.from)])
  userAssetFrom.underlyingBalance = underlyingBalanceFrom[0].toBigInt()

  // TODO - incorporate BigDecimal
  userAssetFrom.underlyingIndex = userAssetFrom.underlyingBalance.div(userAssetFrom.underlyingPrincipal)
  userAssetFrom.save()

  // USER TO
  // We do the same for userTo as we did for userFrom, but check if user and userAsset entities are null
  let userToID = event.params.to.toHex()
  let userTo = User.load(userToID)
  if (userTo == null) {
    userTo = new User(userToID)
    userTo.assets = []
    userTo.save()
  }

  let userAssetToID = market.symbol.concat('-').concat(userToID)
  let userAssetTo = UserAsset.load(userAssetToID)
  if (userAssetTo == null) {
    userAssetTo = new UserAsset(userToID)
    userAssetTo.user = event.params.to
    userAssetTo.transactionHashes = []
    userAssetTo.transactionTimes = []

    userAssetTo.underlyingPrincipal = BigInt.fromI32(0)
    userAssetTo.underlyingBalance = BigInt.fromI32(0)
    userAssetTo.underlyingIndex = BigInt.fromI32(0)

    userAssetTo.borrowPrincipal = BigInt.fromI32(0)
    userAssetTo.borrowBalance = BigInt.fromI32(0)
    userAssetTo.borrowIndex = BigInt.fromI32(0)
    userAssetTo.borrowInterest = BigInt.fromI32(0)
  }

  let txHashesTo = userAssetTo.transactionHashes
  txHashesTo.push(event.transaction.hash)
  userAssetTo.transactionHashes = txHashesTo
  let txTimesTo = userAssetTo.transactionTimes
  txTimesTo.push(event.block.timestamp.toI32())
  userAssetTo.transactionTimes = txTimesTo

  let accountSnapshotTo = contract.getAccountSnapshot(event.params.to)
  userAssetTo.cTokenBalance = accountSnapshotTo.value1
  userAssetTo.borrowBalance = accountSnapshotTo.value2 // might as well update this

  let underlyingBalanceTo = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.to)])
  userAssetTo.underlyingBalance = underlyingBalanceTo[0].toBigInt()

  // TODO - incorporate BigDecimal
  userAssetTo.underlyingIndex = userAssetTo.underlyingBalance.div(userAssetTo.underlyingPrincipal)
  userAssetTo.save()

  // }

}
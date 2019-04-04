import {BigInt} from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  CErc20
} from '../types/cBAT/CErc20'

import {
  Market,
  User,
  UserAsset,
  CTok
} from '../types/schema'

// TODO - handle approval? probably not but will double check

/* User supplies assets into market and receives cTokens in exchange
 * Note - Transfer event also gets emitted, but some info is duplicate, so must handle so we don't
 *        double down on tokens
 *
 */
export function handleMint(event: Mint): void {
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if(user == null){
    user = new User(userID)
    user.assets = []
    user.save()
  }

  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CErc20.bind(event.address)
  if(market == null){
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

  // passes in a user, and the amount of token
  // updates user
  // updates UserAssetbalance
  // event.mintAmount is the underlying asset
  // event.minttoknes is the ctokens
  // event.minter is the user
  // mints actually originate from the ctoken address, not 0x000000

  let userAssetID = market.symbol.concat('-').concat(userID)
  let userAsset = UserAsset.load(userAssetID)
  if(userAsset == null){
    userAsset = new UserAsset(userAssetID)
    userAsset.reserveBalance = BigInt.fromI32(0)
    userAsset.borrowPrincipal = BigInt.fromI32(0)
    userAsset.borrowIndex = BigInt.fromI32(0)
  }
  let accountSnapshot = contract.getAccountSnapshot(event.params.minter)
  userAsset.cTokenBalance = accountSnapshot.value1
  userAsset.borrowBalance = accountSnapshot.value2
  userAsset.reserveBalance = userAsset.reserveBalance.plus(event.params.mintAmount)

  // still need
    // cTokenIndex personal % (reserve inflation %)
    // reserve Inflation real
    // total borrow interest (in unit)
    // total borrow index (in %)

}

export function handleRedeem(event: Redeem): void {

}

export function handleBorrow(event: Borrow): void {

}

export function handleRepayBorrow(event: RepayBorrow): void {

}

export function handleLiquidateBorrow(event: LiquidateBorrow): void {

}

export function handleTransfer(event: Transfer): void {

}
import {BigDecimal} from '@graphprotocol/graph-ts'
import {
  MarketEntered,
  MarketExited,
  NewCloseFactor,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewMaxAssets,
  NewPriceOracle
} from '../types/comptroller/Comptroller'

import {
  Market,
  Comptroller,
} from '../types/schema'

// TODO - uncomment when i am not testing with just REP
export function handleMarketEntered(event: MarketEntered): void {
  // let id = event.params.cToken.toHexString()
  // let market = Market.load(id)
  // let previousUsers = market.usersEntered
  // previousUsers.push(event.params.account)
  // market.usersEntered = previousUsers
  // market.save()
}

// TODO - uncomment when i am not testing with just REP
export function handleMarketExited(event: MarketExited): void {
  // let id = event.params.cToken.toHexString()
  // let market = Market.load(id)
  // let previousUsers = market.usersEntered
  // let i = previousUsers.indexOf(event.params.account)
  // previousUsers.splice(i, 1)
  // market.usersEntered = previousUsers
  // market.save()
}


export function handleNewCloseFactor(event: NewCloseFactor): void {
  let comptroller = Comptroller.load("1")
  comptroller.closeFactor = event.params.newCloseFactorMantissa
  comptroller.save()
}

// TODO - uncomment when i am not testing with just REP
export function handleNewCollateralFactor(event: NewCollateralFactor): void {
  // let market = Market.load(event.params.cToken.toHexString())
  // market.collateralFactor = event.params.newCollateralFactorMantissa as BigDecimal
  // market.save()
}

// This should still be the first event.... weird
export function handleNewLiquidationIncentive(event: NewLiquidationIncentive): void {
  let comptroller = Comptroller.load("1")
  comptroller.liquidationIncentive = event.params.newLiquidationIncentiveMantissa
  comptroller.save()
}

export function handleNewMaxAssets(event: NewMaxAssets): void {
  let comptroller = Comptroller.load("1")
  comptroller.maxAssets = event.params.newMaxAssets
  comptroller.save()
}

export function handleNewPriceOracle(event: NewPriceOracle): void {
  let comptroller = Comptroller.load("1")
  // This is the first event used in this mapping, so we use it to create the entity
  if (comptroller == null) {
    comptroller = new Comptroller("1")
  }
  comptroller.priceOracle = event.params.newPriceOracle
  comptroller.save()
}



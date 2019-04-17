# Compound-V2-subgraph
[Compound](https://compound.finance/) is an open-source protocol for algorithmic, efficient Money Markets on the Ethereum blockchain. This Subgraph ingests the V2 contracts of the protocol. See [here](https://github.com/graphprotocol/compound-subgraph) for the V1 subgraph.

## Networks and Performance

This subgraph can be found on The Graph Hosted Service at https://thegraph.com/explorer/subgraph/compound-finance/compound.

You can also run this subgraph locally, if you wish. Instructions for that can be found in [The Graph Documentation](https://thegraph.com/docs/quick-start). 

## Contract Upgrades

The subgraph will be kept in sync with the development of Compound-V2 until the official mainnet launch. The Hosted service will always be updated with the most recent subgraph. 

After that, the only changes to V2 should be new assets added, which the subgraph will stay up to date with. This may be possible to do so dynamically, without subgraph updates. To be concluded. 

### Contracts not tracked at all

These contracts were left out:

- `Comptroller.sol` - May be tracked in the future, but we are waiting until it is audited before considering it for the subgraph
- `PriceOracle.sol` - For the testnet this is just a simple price oracle, it will be updated to a real one on mainnet, and likely included in the subgraph
- `StableCoinInterestRateModel.sol` - No data was chosen to be sourced from here 
- `StandardInterestRateModel.sol` - No data was chosen to be sourced from here 


## Getting started with querying 
Below are a few ways to show how to query the Compound V2 Subgraph for data. The queries show most of the information that is queryable, but there are many other filtering options that can be used, just check out the [querying api](https://github.com/graphprotocol/graph-node/blob/master/docs/graphql-api.md).

### Querying All Markets
```graphql
{
  markets{
    id
    symbol
    accrualBlockNumber
    totalSupply
    exchangeRate
    totalReserves
    totalCash
    totalDeposits
    totalBorrows
    perBlockBorrowInterest
    perBlockSupplyInterest
    borrowIndex
    tokenPerEthRatio
    tokenPerUSDRatio
  }
}
```

### Querying All Users, and all their CToken balances
Commented out values are temporarily not being used. 
```graphql
{
  users{
    id
    countLiquidated
    countLiquidator
    accountLiquidity
    availableToBorrowEth
#    totalSupplyInEth
#    totalBorrowInEth
    cTokens{
      id
      user
      accrualBlockNumber
      transactionTimes
      transactionHashes
      cTokenBalance
      underlyingSupplied
      underlyingRedeemed
#      underlyingBalance
#      interestEarned
      totalBorrowed
      totalRepaid
#      borrowBalance
#      borrowInterest
    }
  }
}
```
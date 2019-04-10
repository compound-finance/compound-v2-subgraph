# compound-V2-subgraph
Compound is an open-source protocol for algorithmic, efficient Money Markets on the Ethereum blockchain.

# Query

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
  }
  users{
    id
    countLiquidated
    countLiquidator
    assets{
      id
      user
      accrualBlockNumber
      transactionTimes
      transactionHashes
      cTokenBalance
      underlyingSupplied
      underlyingRedeemed
      underlyingBalance
      interestEarned
      totalBorrowed
      totalRepaid
      borrowBalance
      borrowInterest
    }
  }
}
```
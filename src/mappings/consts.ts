import { BigDecimal } from '@graphprotocol/graph-ts'

// export const USDC_ADDRESS = "0x80b5a32E4F032B2a058b4F29EC95EEfEEB87aDcd";
export const cUSDC_ADDRESS = '0x0dD6241bFE519fB1c1B654877b66311c355804c5'
// export const cETH_ADDRESS = "0x830b9849E7D79B92408a86A557e7baAACBeC6030";
export const cCANTO_ADDRESS = '0xB65Ec550ff356EcA6150F733bA9B954b2e0Ca488'
export const cCANTO_ADDRESS_SMALL_CASE = '0xb65ec550ff356eca6150f733ba9b954b2e0ca488'
// export const cW_CANTO_ADDRESS = "0x5e23dc409fc2f832f83cec191e245a191a4bcc5c";
// export const wCANTO_ADDRESS = "0x826551890Dc65655a0Aceca109aB11AbDbD7a07B";
export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export const BaseV1Router_Address = '0x8fa61F21Fb514d2914a48B29810900Da876E295b'

export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let HUNDRED_BD = BigDecimal.fromString('100')
export let NegOne_BD = BigDecimal.fromString('-1')

export const MANTISSA_FACTOR = 18
export let MANTISSA_FACTOR_BD = BigDecimal.fromString(MANTISSA_FACTOR.toString())

export const BLOCK_TIME = 5
export let BLOCK_TIME_BD = BigDecimal.fromString(BLOCK_TIME.toString())

export const SECONDS_IN_DAY = 24 * 60 * 60
export let SECONDS_IN_DAY_BD = BigDecimal.fromString(SECONDS_IN_DAY.toString())

export const DAYS_IN_YEAR = 365
export let DAYS_IN_YEAR_BD = BigDecimal.fromString(DAYS_IN_YEAR.toString())

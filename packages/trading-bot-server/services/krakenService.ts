const Kraken = require('kraken-wrapper') // no d.ts file... gotta figure out heroku deploy
// import { mongoClient, logKrakenResult } from './mongoDbService';
import KrakenOrderDetails from '../models/kraken/KrakenOrderDetails'
import { logOrderResult } from './logger'
import {
  KrakenPrice,
  KrakenPriceResult,
  KrakenTradeablePair,
  KrakenTradeablePairResult,
  KrakenBalance,
  KrakenBalanceResult,
  KrakenOpenPositionResult,
  KrakenOpenOrderResult,
  KrakenOpenOrders,
  KrakenOrderResult,
  KrakenOrderResponse,
  KrakenOpenPosition,
  KrakenOpenPositions,
  KrakenTradeBalance,
  KrakenTradeBalanceResult,
  KrakenClosedOrderResult,
} from '../models/kraken/KrakenResults'
import { sleep, superParseFloat, logBreak } from '../scripts/common'
import { KrakenOrder } from '../models/kraken/KrakenOrder'

class KrakenService {
  kraken: any // krakenApi

  constructor(kraken: any) {
    this.kraken = kraken
  }

  async getPair(krakenTicker: string): Promise<KrakenTradeablePair> {
    const { error, pair } = new KrakenTradeablePairResult(
      await this.kraken.getTradableAssetPairs({
        pair: krakenTicker,
      })
    )

    if (error?.length > 0) {
      throw new Error(`Pair data for ${krakenTicker} not available on Kraken`)
    }

    return pair
  }

  async getPrice(krakenTicker: string): Promise<KrakenPrice> {
    const { error, price } = new KrakenPriceResult(
      await this.kraken.getTickerInformation({
        pair: krakenTicker,
      })
    )

    if (error?.length > 0) {
      throw new Error(`Price info for ${krakenTicker} not available on Kraken`)
    }

    return price
  }

  async getBalance(): Promise<KrakenBalance> {
    const { error, balances } = new KrakenBalanceResult(
      await this.kraken.getBalance()
    )

    if (error?.length > 0) {
      throw new Error(`Could not find balance info on Kraken`)
    }

    return balances
  }

  async getTradeBalance(): Promise<KrakenTradeBalance> {
    const { error, balances } = new KrakenTradeBalanceResult(
      await this.kraken.getTradeBalance()
    )

    if (error?.length > 0) {
      console.log('Could not get trade balance')
    }

    return balances
  }

  async getOpenOrders(): Promise<KrakenOpenOrders> {
    const { error, openOrders } = new KrakenOpenOrderResult(
      await this.kraken.getOpenOrders()
    )

    if (error?.length > 0) {
      console.log('Could not get open orders')
    }

    return openOrders
  }

  async getOpenPositions(): Promise<KrakenOpenPositionResult> {
    return new KrakenOpenPositionResult(await this.kraken.getOpenPositions())
  }

  async getClosedOrders(): Promise<any> {
    const { error, closedOrders } = new KrakenClosedOrderResult(
      await this.kraken.getClosedOrders()
    )

    if (error?.length > 0) {
      console.log('Could not get closed orders')
    }

    return closedOrders
  }

  async getOrderBook(pair: string) {
    const {
      error: orderBookError,
      openPositions: orderBookData,
    } = await this.kraken.getOrderBook({
      pair,
    })

    return { orderBookError, orderBookData }
  }

  async setAddOrder(krakenOrder: KrakenOrder): Promise<KrakenOrderResponse> {
    return this.kraken.setAddOrder(krakenOrder.orderify())
  }

  async placeOrder(
    krakenOrder: KrakenOrder,
    desc = 'ORDER',
    checkOrder = true
  ) {
    const result = await this.setAddOrder(krakenOrder)

    krakenOrder.orderId = result.result?.txid ? result.result.txid[0] : ''

    if (checkOrder) {
      setTimeout(async () => {
        this.checkOrder(krakenOrder, 1)
      }, 100000)
    }

    logOrderResult(desc, result, krakenOrder.pair)

    return result
  }

  async handleLeveragedOrder(
    order: KrakenOrderDetails
  ): Promise<KrakenOrderResponse | undefined> {
    let latestResult

    let { openPositions } = await this.getOpenPositions()

    let add = false
    // let flip = false;
    let positionMargin = 0
    // let positionVolume = 0;
    let prices: number[] = []
    for (const key in openPositions) {
      const position = openPositions[key]
      if (
        order.krakenTicker === position.pair &&
        order.action === position.type
      ) {
        add = true
        positionMargin += parseFloat(position.margin)
        prices.push(parseFloat(position.cost) / parseFloat(position.vol))
      } else if (
        order.krakenTicker === position.pair &&
        order.action !== position.type
      ) {
        // flip = true;
        // console.log(position);
        positionMargin += parseFloat(position.margin)
        // positionVolume += parseFloat(position.vol);
      }
    }

    // if (flip) {
    //   let orderVolume = positionVolume + order.tradeVolume; // to flip

    //   console.log("Flipping");
    //   if (positionMargin > order.marginFree) {
    //     console.log("Margin level too low. Settling first");
    //     latestResult = await this.settleLeveragedOrder(order);
    //     orderVolume = order.tradeVolume; // reset back to just order volume
    //   }

    //   const krakenOrder = new KrakenOrder({
    //     pair: order.krakenTicker,
    //     krakenizedPair: order.krakenizedTradingViewTicker,
    //     type: order.action,
    //     ordertype: "limit",
    //     price: order.bidPrice,
    //     volume: orderVolume,
    //     leverage: order.leverageAmount,
    //   });

    //   latestResult = await this.placeOrder(krakenOrder, `ORDER Flipped`);

    //   return;
    // }

    // if (order.marginFree < order.lowestLeverageMargin) {
    //   console.log("Margin level too low, selling some.");
    //   const positionsBySize = await this.getOpenPositionsBySize(openPositions);
    //   // const positionsByTime = await this.getOrdersByTimeAsc();
    //   latestResult = await this.sellOldestOrders(
    //     order,
    //     positionsBySize.keys().next().value,
    //     // positionsByTime[0].pair,
    //     openPositions
    //   );
    // }

    if (add) {
      const addCount =
        parseInt(
          (
            (Math.floor(positionMargin) - order.entrySize) /
            order.originalAdd
          ).toFixed(0)
        ) + 1
      // const minAdds = positionMargin >= order.maxInitialPositionSizeInDollar;
      // const tooMuch = positionMargin >= order.maxPositionSizeInDollar;

      // get average price of positions
      let averagePrice = superParseFloat(
        prices.reduce((a, b) => a + b) / prices.length,
        order.priceDecimals
      )
      let percentDiff = parseFloat(
        (
          ((order.bidPrice - averagePrice) /
            ((order.bidPrice + averagePrice) / 2)) *
          100
        ).toFixed(2)
      )

      // if ahead of average price (aka bid price > average), lower add value, otherwise, raise add value
      // this attempts to bring the average down when behind and add smaller when ahead
      percentDiff = order.action === 'sell' ? percentDiff * -1 : percentDiff
      const boostPercentDiff = percentDiff * -5.5
      const boost = parseFloat((1 + boostPercentDiff / 100).toFixed(4))

      const incrementalAddVolume = parseFloat(
        (order.addVolume * boost).toFixed(order.volumeDecimals)
      ) // incrementalVolume > order.minVolume ? incrementalVolume : order.minVolume;
      const incrementalAddDollar = (
        (order.positionSize || order.addSize) * boost
      ).toFixed(2)
      const myPositionAfter = (
        positionMargin + parseFloat(incrementalAddDollar)
      ).toFixed(2)
      const marginPositionAfter = parseFloat(
        (parseFloat(myPositionAfter) * (order.leverageAmount || 1)).toFixed(2)
      )

      console.log(`Diff: ${averagePrice} | ${order.bidPrice} | ${percentDiff}%`)
      console.log(
        `Boost: ${order.addSize.toFixed(
          2
        )} | ${boost}x | ${incrementalAddDollar}`
      )
      console.log(
        `Position: ${addCount} | ${myPositionAfter} | ${marginPositionAfter}`
      )

      const krakenOrder = new KrakenOrder({
        pair: order.krakenTicker,
        krakenizedPair: order.krakenizedTradingViewTicker,
        type: order.action,
        ordertype: 'limit',
        price: order.bidPrice,
        volume: incrementalAddVolume,
        leverage: order.leverageAmount,
      })

      latestResult = await this.placeOrder(krakenOrder)
    } else if (!add) {
      console.log(
        `New Entry: ${order.entrySize} | ${
          order.entrySize * (order.leverageAmount || 1)
        }`
      )

      const krakenOrder = new KrakenOrder({
        pair: order.krakenTicker,
        krakenizedPair: order.krakenizedTradingViewTicker,
        type: order.action,
        ordertype: 'limit',
        price: order.bidPrice,
        volume: order.tradeVolume,
        leverage: order.leverageAmount,
      })

      latestResult = await this.placeOrder(krakenOrder)
    }

    return latestResult
  }

  async handleNonLeveragedOrder(
    order: KrakenOrderDetails,
    type: 'market' | 'limit' = 'limit'
  ): Promise<KrakenOrderResponse | undefined> {
    let result
    if (order.action === 'sell') {
      if (order.balanceInDollar === 0) {
        result = new KrakenOrderResult({
          error: [`${order.action.toUpperCase()} balance is too small`],
        })
      } else {
        console.log(
          order.sellBags
            ? `Selling Bags`
            : `Selling: ${order.tradeVolumeInDollar}`
        )

        const krakenOrder = new KrakenOrder({
          pair: order.krakenTicker,
          krakenizedPair: order.krakenizedTradingViewTicker,
          type: order.action,
          ordertype: type,
          price: order.bidPrice,
          volume: order.tradeVolume,
        })

        result = await this.placeOrder(krakenOrder)
      }
    } else {
      if (order.balanceInDollar === 0) {
        if (order.marginFree > order.lowestNonLeverageMargin) {
          console.log(`New Entry: ${order.tradeVolumeInDollar.toFixed(0)}`)

          const krakenOrder = new KrakenOrder({
            pair: order.krakenTicker,
            krakenizedPair: order.krakenizedTradingViewTicker,
            type: order.action,
            ordertype: type,
            price: order.bidPrice,
            volume: order.tradeVolume,
          })

          result = await this.placeOrder(krakenOrder)
        } else {
          console.log('No balance and margin is too low. Ignoring.')
        }
      } else {
        if (!order.buyBags) {
          console.log(
            `Balance After: ${(
              order.balanceInDollar + order.tradeVolumeInDollar
            ).toFixed(2)}`
          )
        }

        const krakenOrder = new KrakenOrder({
          pair: order.krakenTicker,
          krakenizedPair: order.krakenizedTradingViewTicker,
          type: order.action,
          ordertype: type,
          price: order.bidPrice,
          volume: order.tradeVolume,
        })

        result = await this.placeOrder(krakenOrder)
      }
    }

    // await logKrakenResult(order, result);
    return result
  }

  async settleLeveragedOrder(
    order: KrakenOrderDetails
  ): Promise<KrakenOrderResponse | undefined> {
    let latestResult

    // cancel open add order for this group. Some might not have been picked up
    await this.cancelOpenOrdersForPair(order, order.action)
    await this.cancelOpenOrdersForPair(order, order.oppositeAction)

    const { openPositions } = await this.getOpenPositions()
    // cost * margin
    if (order.txId) {
      // close out specific transaction only (at least the value of it since we can't specify closing by id)
      // we don't break the for loop because there may be 2 or more orders filled in a transaction
      for (const key in openPositions) {
        const position = openPositions[key]
        if (
          position.pair === order.krakenTicker &&
          position.ordertxid === order.txId
        ) {
          latestResult = await this.settleTxId(position, order)
        }
      }
    } else if (order.closePositionSize) {
      // close out specific position size
      const positionsForPair: KrakenOpenPosition[] = []
      for (const key in openPositions) {
        const position = openPositions[key]
        if (position.pair === order.krakenTicker) {
          positionsForPair.push(position)
        }
      }
      if (order.positionSize) {
        const count =
          order.positionSize >= 1
            ? order.positionSize
            : Math.floor(positionsForPair.length * order.positionSize)
        console.log(`Selling ${count} Positions for ${order.tradingViewTicker}`)
        latestResult = await this.sellOldestOrders(
          order,
          order.krakenTicker,
          openPositions,
          count
        )
      } else {
        console.log('No position size specified. Cancelling.')
      }
    } else {
      let positionMargin = 0
      let prices: number[] = []

      for (const key in openPositions) {
        const position = openPositions[key]
        if (
          order.krakenTicker === position.pair &&
          order.oppositeAction === position.type
        ) {
          positionMargin += parseFloat(position.margin)
          prices.push(parseFloat(position.cost) / parseFloat(position.vol))
        }
      }

      if (prices.length > 0) {
        // get average price of positions
        let averagePrice = superParseFloat(
          prices.reduce((a, b) => a + b) / prices.length,
          order.priceDecimals
        )
        let percentDiff = parseFloat(
          (
            ((order.bidPrice - averagePrice) /
              ((order.bidPrice + averagePrice) / 2)) *
            100
          ).toFixed(2)
        )
        percentDiff = order.action === 'buy' ? percentDiff * -1 : percentDiff

        const myPositionAfter = positionMargin.toFixed(2)
        const marginPositionAfter = parseFloat(
          (
            parseFloat(positionMargin.toFixed(2)) * (order.leverageAmount || 1)
          ).toFixed(2)
        )
        console.log(
          `Diff: ${averagePrice} | ${order.bidPrice} | ${percentDiff}%`
        )
        console.log(`Position: ${myPositionAfter} | ${marginPositionAfter}`)

        const krakenOrder = new KrakenOrder({
          pair: order.krakenTicker,
          krakenizedPair: order.krakenizedTradingViewTicker,
          type: order.action,
          ordertype: 'limit',
          price: order.bidPrice,
          volume: 0, // 0 for close all
          leverage: order.leverageAmount,
        })

        latestResult = await this.placeOrder(krakenOrder, 'SETTLED')
      }
    }

    if (!latestResult) {
      console.log('Nothing to close')
    }

    return latestResult
  }

  async cancelOpenOrdersForPair(
    order: KrakenOrderDetails,
    orderType: 'buy' | 'sell'
  ) {
    const open = order.openOrders?.open

    if (!open) return

    await this.cancelOrdersOlderThanLimit(order)

    let result
    for (const key in open) {
      const pair = open[key]['descr']['pair']
      const type = open[key]['descr']['type']

      if (pair === order.krakenizedTradingViewTicker && type === orderType) {
        console.log(`Canceling ${type} order`)
        result = await this.kraken.setCancelOrder({ txid: key })
      }
    }

    // if closing order, make sure there are no leftovers sells as well
    // this occurs when we sell oldest order, and it does not fill
    // this resulted in a short position that lost 15% -_- never again
    // if (order.close) {
    //   await this.cancelOpenOrdersForPair(order, false);
    // }

    return result
  }

  async cancelOrdersOlderThanLimit(order: KrakenOrderDetails) {
    let result
    const open = order.openOrders?.open

    if (!open) return

    for (const key in open) {
      const pair = open[key]['descr']['pair']
      const type = open[key]['descr']['type']
      const starttm = open[key]['opentm']
      const startDate = new Date(starttm * 1000).toUTCString()
      const timeLimit = new Date(Date.now() - 10 * 60 * 1000).toUTCString() // 10 min

      if (startDate < timeLimit) {
        console.log(`Old ${type} ${pair}. Cancelling.`)
        result = await this.kraken.setCancelOrder({ txid: key })
      }
    }
    return result
  }

  async checkOrder(krakenOrder: KrakenOrder, count: number) {
    const openOrders = await this.getOpenOrders()

    const openOrder = openOrders?.open[krakenOrder.orderId]

    if (
      openOrder
      // openOrder.descr.pair === krakenOrder.krakenizedPair &&
      // openOrder.descr.type === krakenOrder.type
    ) {
      console.log(
        `Limit not picked up. Switching to market order. Try: ${count}`
      )

      await this.kraken.setCancelOrder({ txid: krakenOrder.orderId })

      const volumeRemaining =
        parseFloat(openOrder.vol) - parseFloat(openOrder.vol_exec)

      const krakenMarketOrder = new KrakenOrder({
        ...krakenOrder,
        volume: volumeRemaining,
        ordertype: 'market',
      })

      const result = await this.placeOrder(krakenMarketOrder, `ORDER`, false)

      // market price for comparison
      const price = await this.getPrice(krakenMarketOrder.krakenizedPair)
      const currentPrice = superParseFloat(
        price[krakenMarketOrder.pair]['c'][0],
        4
      )
      console.log(`${krakenOrder.price} | ${currentPrice}`)

      krakenMarketOrder.orderId = result.result?.txid
        ? result.result.txid[0]
        : ''

      // check if insufficient margin
      setTimeout(async () => {
        this.checkOrder(krakenMarketOrder, count++)
      }, 5000)

      logBreak()
    }

    const closedOrders = await this.getClosedOrders()

    const closedOrder = closedOrders?.closed[krakenOrder.orderId]
    // console.log(closedOrder);

    if (
      closedOrder?.reason?.toLowerCase() == 'insufficient margin' &&
      count < 9
    ) {
      console.log(
        `Trying again... Order closed due to insufficient margin. Try ${count}`
      )

      // Try again with original limit order
      const result = await this.placeOrder(krakenOrder, `ORDER`)

      krakenOrder.orderId = result.result?.txid ? result.result.txid[0] : ''

      setTimeout(async () => {
        this.checkOrder(krakenOrder, count++)
      }, 5000)

      logBreak()
    }
  }

  async handleBags(
    order: KrakenOrderDetails
  ): Promise<KrakenOrderResponse | undefined> {
    if (order.balanceOfQuote > 0) {
      let totalVolumeToTradeInDollar: number, result
      logBreak()

      // convert to dollar. If greater than 1 bag size, we assume it's a dollar amount, else percent
      if (order.bagAmount > 1) {
        totalVolumeToTradeInDollar = superParseFloat(
          order.bagAmount,
          order.priceDecimals
        )
      } else if (order.buyBags) {
        const bagAmount = order.bagAmount > 0 ? order.bagAmount : 0.7
        totalVolumeToTradeInDollar = superParseFloat(
          order.balanceOfQuote * bagAmount,
          order.priceDecimals
        )
      } else {
        const bagAmount = order.bagAmount > 0 ? order.bagAmount : 0.85
        totalVolumeToTradeInDollar = superParseFloat(
          order.balanceOfBase * order.usdValueOfBase * bagAmount,
          order.priceDecimals
        )
      }

      let volumeTradedInDollar = 0
      let i = 0
      let dollarVolumeLeft = totalVolumeToTradeInDollar
      // for (let dollarVolumeLeft = totalVolumeToTradeInDollar, )
      while (volumeTradedInDollar < totalVolumeToTradeInDollar) {
        if (i > 8) {
          console.log(
            `Easy there buddy. Lots of looping going on. Canceling for good measure`
          )
          break
        }
        // if margin too low for volume, we'll trade 80% at a time
        const newOrder = <KrakenOrderDetails>{ ...order }
        newOrder.tradeVolume =
          newOrder.marginFree < dollarVolumeLeft
            ? superParseFloat(
                (newOrder.marginFree * 0.8) / newOrder.usdValueOfBase,
                newOrder.volumeDecimals
              )
            : superParseFloat(
                dollarVolumeLeft / newOrder.usdValueOfBase,
                newOrder.volumeDecimals
              )
        newOrder.tradeVolumeInDollar = superParseFloat(
          newOrder.tradeVolume * order.usdValueOfBase,
          order.priceDecimals
        )

        if (newOrder.tradeVolume < newOrder.minVolume) {
          console.log(
            `Trade volume too low. Ignoring the last bit. $${volumeTradedInDollar} Traded.`
          )
          return
        }

        volumeTradedInDollar += newOrder.tradeVolumeInDollar
        dollarVolumeLeft = totalVolumeToTradeInDollar - volumeTradedInDollar

        // market orders. waiting 2 seconds between for good measure
        setTimeout(async () => {
          if (i === 0) {
            console.log('Buying Bags')
            console.log(
              `Balance After: ${(
                order.balanceInDollar + totalVolumeToTradeInDollar
              ).toFixed(2)}`
            )
          }

          // order market order to fill immediately
          result = await this.handleNonLeveragedOrder(newOrder, 'market')
          logBreak()
        }, 2000)

        i++
      }
      return result
    } else {
      console.log('No USD to trade')
      return
    }
  }

  async settleTxId(
    position: KrakenOpenPosition,
    order: KrakenOrderDetails,
    immediate = true,
    additionalVolume = 0
  ) {
    const closeAction = position.type === 'sell' ? 'buy' : 'sell'
    // const volumeToClose = parseFloat(position.vol) - parseFloat(position.vol_closed);
    const volumeToClose = parseFloat(position.vol) + additionalVolume
    let bidPrice = order.bidPrice
    let leverageAmount = order.leverageAmount

    // if tx is not this pair, get data for it. used mostly in settle oldest transaction
    // if (position.pair !== order.krakenTicker) {
    const price = await kraken.getPrice(position.pair)
    const pair = await kraken.getPair(position.pair)

    const currentBid = price[position.pair]['b'][0]
    const currentAsk = price[position.pair]['a'][0]
    const leverageBuyAmounts = pair[position.pair]['leverage_buy']
    const leverageSellAmounts = pair[position.pair]['leverage_sell']

    // TODO: Calculate this better
    if (!immediate && position.pair === order.krakenTicker) {
      // update bid and ask since we've got it
      // TODO: allow getbid for non similar pair
      order.currentAsk = parseFloat(currentAsk)
      order.currentBid = parseFloat(currentBid)
      bidPrice = order.getBid()
    } else {
      bidPrice =
        position.type === 'buy'
          ? parseFloat(currentAsk)
          : parseFloat(currentBid)
    }
    leverageAmount =
      position.type === 'buy'
        ? leverageBuyAmounts[leverageBuyAmounts.length - 1]
        : leverageSellAmounts[leverageSellAmounts.length - 1]

    console.log(
      `Bid for Pair: ${currentBid} | Ask for Pair: ${currentAsk} | My Bid: ${bidPrice}`
    )

    const krakenOrder = new KrakenOrder({
      pair: position.pair,
      krakenizedPair: order.krakenizedTradingViewTicker,
      type: closeAction,
      ordertype: 'limit',
      price: bidPrice,
      volume: volumeToClose,
      leverage: leverageAmount,
    })

    let result = await this.placeOrder(krakenOrder, 'SETTLED')

    if (result.error.length) {
      console.log('Could not sell oldest. Combining')
      const positions = await this.getOrdersByTimeAsc(position.pair)

      result = await this.settleTxId(positions[1], order, false, volumeToClose)
    }

    return result
  }

  async sellOldestOrders(
    order: KrakenOrderDetails,
    pair: string,
    openPositions?: KrakenOpenPositions,
    count = 1
  ) {
    let pairPositions
    if (!openPositions) {
      pairPositions = await this.getOrdersByTimeAsc(pair)
    } else {
      pairPositions = await this.getOrdersByTimeAsc(pair, openPositions)
    }

    const openOrders = await this.getOpenOrders()

    let result
    for (let i = 0; i < count; i++) {
      let positionToClose: KrakenOpenPosition | undefined = pairPositions[i]

      const open = openOrders?.open
      for (const orderId in open) {
        const openOrder = open[orderId]
        // if position to close is already open, go to next position
        positionToClose =
          openOrder.descr.pair === positionToClose?.pair &&
          openOrder.vol === positionToClose?.vol
            ? pairPositions[i + 1]
            : positionToClose
      }

      if (positionToClose) {
        result = await this.settleTxId(positionToClose, order, true)
      } else {
        console.log(`Couldn't find position to close`)
      }
    }

    return result
  }

  // async getPositionsForPair()

  async getOrdersByTimeAsc(
    // order: KrakenOpenPosition | KrakenOrderDetails,
    pair?: string,
    openPositions?: KrakenOpenPositions
  ): Promise<KrakenOpenPosition[]> {
    if (!openPositions) {
      const positionResult = await this.getOpenPositions()
      openPositions = positionResult.openPositions
    }

    // const action = this.isOpenPosition(pair) ? pair.type : pair.action;
    // const pairTicker = this.isOpenPosition(order) ? order.pair : order.krakenTicker;

    let positions = []
    for (const key in openPositions) {
      const position = openPositions[key]
      if (!pair || pair === position.pair) {
        positions.push(position)
      }
    }

    return positions.sort((a, b) => a.time - b.time)
  }

  async getOpenPositionsBySize(openPositions?: KrakenOpenPositions) {
    if (!openPositions) {
      const positionResult = await this.getOpenPositions()
      openPositions = positionResult.openPositions
    }

    let positions = new Map()
    for (const key in openPositions) {
      const position = openPositions[key]

      const currentCost = positions.has(position.pair)
        ? positions.get(position.pair)
        : 0
      positions.set(position.pair, currentCost + parseFloat(position.cost))
    }
    // thanks stack overflow
    return new Map([...positions.entries()].sort((a, b) => b[1] - a[1]))
  }

  isOpenPosition(
    whatIsIt: KrakenOpenPosition | KrakenOrderDetails
  ): whatIsIt is KrakenOpenPosition {
    return (
      (<KrakenOpenPosition>whatIsIt).type !== undefined &&
      (<KrakenOpenPosition>whatIsIt).pair !== undefined
    )
  }

  // async balancePortfolio() {
  //   const { balances } = await this.getBalance();
  //   console.log('USD Balance Before Rebalance:', balances['ZUSD']);

  //   const { openPositions } = await this.getOpenPositions();

  //   let longEthBtc, longBtcUsd, longEthUsd;
  //   for (const key in openPositions) {
  //     const pair = openPositions[key]['pair'];
  //     const type = openPositions[key]['type'];

  //     if (pair === 'XETHXXBT') {
  //       longEthBtc = type === 'buy';
  //     } else if (pair === 'XXBTZUSD') {
  //       longBtcUsd = type === 'buy';
  //     } else if (pair === 'XETHZUSD') {
  //       longEthUsd = type === 'buy';
  //     }
  //   }

  //   console.log(longEthBtc, longBtcUsd, longEthUsd);

  //   return balances;
  // }
}

const krakenApi = new Kraken(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_SECRET_KEY
)
export const kraken = new KrakenService(krakenApi)

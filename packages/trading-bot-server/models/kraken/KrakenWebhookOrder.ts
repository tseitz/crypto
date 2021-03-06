import { KrakenOrderResponse } from './KrakenResults'
import { KrakenTradingViewBody } from '../TradingViewBody'
import { kraken } from '../../services/krakenService'
import KrakenOrderDetails from './KrakenOrderDetails'

export class KrakenWebhookOrder {
  requestBody: KrakenTradingViewBody
  tradingViewTicker: string
  krakenTicker: string
  order?: KrakenOrderDetails

  constructor(requestBody: KrakenTradingViewBody) {
    this.requestBody = requestBody
    this.tradingViewTicker = requestBody.ticker
    // Kraken uses XBT instead of BTC. Uniswap uses WETH instead of ETH
    // I use binance/uniswap for most webhooks since there is more volume
    this.krakenTicker = this.tradingViewTicker
      .replace('BTC', 'XBT')
      .replace('WETH', 'ETH')
      .replace('DOGE', 'XDG')
      .replace('USDT', 'USD')
  }

  async placeOrder() {
    try {
      // set up the order
      const orderDetails = await this.initOrder()
      this.order = new KrakenOrderDetails(orderDetails)

      // execute the order
      return await this.openOrder(this.order)
    } catch (error) {
      console.log(error)
      return error
    }
  }

  private async initOrder() {
    // get pair data
    const pairData = await kraken.getPair(this.krakenTicker)

    // get pair price info for order
    const pairPriceInfo = await kraken.getPrice(this.krakenTicker)

    // btc or eth price for calculations (we're currently placing orders in fixed USD amount)
    const assetClass = this.krakenTicker.includes('XBT') ? 'XBTUSDT' : 'ETHUSDT'
    const assetClassPriceInfo = await kraken.getPrice(assetClass)

    const myBalanceInfo = await kraken.getBalance()

    const openOrders = await kraken.getOpenOrders()

    const tradeBalance = await kraken.getTradeBalance()

    return {
      body: this.requestBody,
      krakenizedTicker: this.krakenTicker,
      pairData,
      pairPriceInfo,
      assetClassPriceInfo,
      myBalanceInfo,
      openOrders,
      tradeBalance,
    }
  }

  private async openOrder(
    order: KrakenOrderDetails
  ): Promise<KrakenOrderResponse | undefined> {
    console.log(`Margin Free: ${order.marginFree}`)
    console.log(
      `Price: ${order.tradingViewPrice} | Bid: ${order.bidPrice} | ${order.shortZone}`
    )

    let result
    if (order.oldest) {
      result = await kraken.sellOldestOrders(order, order.krakenTicker)
    } else if (order.bagIt) {
      if (!order.nonLeverageOnly) {
        // close order first, handle bags so funds are available, then handle leverage
        result = await kraken.settleLeveragedOrder(order)

        // wait a second for settle to go through
        setTimeout(async () => {
          result = await kraken.handleLeveragedOrder(order)
        }, 5000)

        // // just wait this one out for now
        // setTimeout(async () => {
        //   // Reset order details based on above order. Mostly margin free...
        //   // TODO: this needs improved
        //   const newOrderInfo = await this.initOrder();
        //   const order = new KrakenOrderDetails(newOrderInfo);
        //   result = await kraken.handleBags(order);
        // }, 105000);
      } else {
        result = await kraken.handleBags(order)
      }
    } else if (order.noLeverage) {
      result = await kraken.handleNonLeveragedOrder(order)
    } else {
      if (order.close) {
        result = await kraken.settleLeveragedOrder(order)
      } else {
        result = await kraken.handleLeveragedOrder(order)
      }
    }

    return result
  }
}

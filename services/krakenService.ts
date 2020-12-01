const Kraken = require('kraken-wrapper'); // no d.ts file... gotta figure out heroku deploy
import KrakenOrderDetails from '../models/kraken/KrakenOrderDetails';
import {
  KrakenPriceResult,
  KrakenTradeablePairResult,
  KrakenBalanceResult,
  KrakenOpenPositionResult,
} from '../models/kraken/KrakenResults';
import { KrakenOrderResponse } from '../models/kraken/KrakenOrderResponse';

class KrakenService {
  kraken: any; // krakenApi

  constructor(kraken: any) {
    this.kraken = kraken;
  }

  async getPair(krakenTicker: string) {
    const {
      error: pairError,
      result: pairData,
    }: KrakenTradeablePairResult = await this.kraken.getTradableAssetPairs({
      pair: krakenTicker,
    });

    return { pairError, pairData };
  }

  async getPrice(krakenTicker: string) {
    const {
      error: priceError,
      result: priceData,
    }: KrakenPriceResult = await this.kraken.getTickerInformation({
      pair: krakenTicker,
    });

    return { priceError, priceData };
  }

  async getBalance() {
    const {
      error: balanceError,
      result: balanceData,
    }: KrakenBalanceResult = await this.kraken.getBalance();

    return { balanceError, balanceData };
  }

  async getOpenOrders() {
    const {
      error: openOrderError,
      result: openOrderData,
    }: KrakenBalanceResult = await this.kraken.getOpenOrders();

    return { openOrderError, openOrderData };
  }

  async getOpenPositions(): Promise<KrakenOpenPositionResult> {
    return new KrakenOpenPositionResult(await this.kraken.getOpenPositions());
  }

  async getOrderBook(pair: string) {
    const { error: orderBookError, openPositions: orderBookData } = await this.kraken.getOrderBook({
      pair,
    });

    return { orderBookError, orderBookData };
  }

  async cancelOpenOrdersForPair(order: KrakenOrderDetails, onlySameType = false) {
    const open = order.openOrders['open'];

    let result;
    for (const key in open) {
      if (open[key]['descr']['pair'] === order.krakenizedTradingViewTicker) {
        // if (!onlySameType || open[key]['descr']['pair'])
        result = await this.kraken.setCancelOrder({ txid: key });
      }
    }

    return result;
  }

  async openOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    // some orders might not have filled. cancel beforehand
    // await this.cancelOpenOrdersForPair(order);

    let result;
    if (typeof order.leverageAmount === 'undefined') {
      result = await this.handleNonLeveragedOrder(order);
    } else {
      result = await this.handleLeveragedOrder(order);
    }

    return result;
  }

  async settleLeveragedOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    const {
      error: openPositionError,
      result: openPositions,
    } = await this.kraken.getOpenPositions();

    // close out positons first
    let latestResult;
    for (const key in openPositions) {
      const position = openPositions[key];
      if (position.pair === order.krakenTicker) {
        const closeAction = position.type === 'sell' ? 'buy' : 'sell';
        // console.log(order.action, position.type);
        const volumeToClose =
          Number.parseFloat(position.vol) - Number.parseFloat(position.vol_closed);
        latestResult = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: closeAction,
          // ordertype: 'market',
          ordertype: 'limit',
          price: position.type === 'sell' ? order.currentBid : order.currentAsk,
          volume: 0, // 0 for close all
          leverage: order.leverageAmount,
          // validate: true,
        });
        console.log('Volume to Close: ', volumeToClose);
        console.log(`${order.krakenTicker} Settled Position: `, latestResult);
      }
    }

    return latestResult;
  }

  async handleLeveragedOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    let result;
    if (order.close) {
      result = await this.settleLeveragedOrder(order);
    } else {
      let { openPositions } = await this.getOpenPositions();

      let add = false;
      for (const key in openPositions) {
        const position = openPositions[key];
        if (order.krakenTicker === position.pair && order.action === position.type) {
          add = true;
          console.log('Position Already Open, Adding');
        } else if (order.krakenTicker === position.pair) {
          console.log("Opposite Order, Should've Closed?");
        }
      }

      if (add) {
        result = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: order.action,
          ordertype: 'limit',
          // ordertype: 'market',
          price: order.bidPrice,
          volume: order.addVolume,
          leverage: order.lowestLeverageAmount,
          // validate: true,
        });
      } else {
        result = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: order.action,
          ordertype: 'limit',
          // ordertype: 'market',
          price: order.bidPrice,
          volume: order.tradeVolume,
          leverage: order.leverageAmount,
          // validate: true,
        });
      }

      console.log(`${order.krakenTicker} Leveraged Order Complete: `, result);
    }

    return result;
  }

  async handleNonLeveragedOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    let result;
    if (order.action === 'sell') {
      if (isNaN(order.balanceOfBase) || order.balanceOfBase < 1e-6) {
        result = new KrakenOrderResponse(
          `${order.krakenTicker} ${order.action.toUpperCase()} balance is too small to sell`
        );
      } else {
        // sell off current balance, we cannot short so stop there
        result = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: order.action,
          ordertype: 'limit',
          volume: order.balanceOfBase,
          price: order.bidPrice,
          // validate: true,
        });
      }
    } else {
      result = await this.kraken.setAddOrder({
        pair: order.krakenTicker,
        type: order.action,
        ordertype: 'limit',
        price: order.bidPrice,
        volume: order.tradeVolume,
        // validate: true,
      });
    }

    console.log(`${order.krakenTicker} Non Leveraged Order Complete: `, result);
    return result;
  }

  async balancePortfolio() {
    const { balanceData: balances } = await this.getBalance();
    console.log('USD Balance Before Rebalance:', balances['ZUSD']);

    const { openPositions } = await this.getOpenPositions();

    for (const key in openPositions) {
      const position = openPositions[key];
      // TODO: if short everything, hold
      if (position['pair'] === 'XETHXXBT') {
        if (position.type === 'sell') {
          console.log('Short ETHBTC so Long BTC');
          // mostly btc
        } else {
          console.log('Long ETHBTC so Long ETH');
          // mostly eth
        }
      }
    }

    return balances;
  }
}

const krakenApi = new Kraken(process.env.KRAKEN_API_KEY, process.env.KRAKEN_SECRET_KEY);
export const kraken = new KrakenService(krakenApi);
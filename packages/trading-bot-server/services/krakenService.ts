const Kraken = require('kraken-wrapper'); // no d.ts file... gotta figure out heroku deploy
import KrakenOrderDetails from '../models/kraken/KrakenOrderDetails';
import { logOrderResult } from './logger';
import {
  KrakenPriceResult,
  KrakenTradeablePairResult,
  KrakenBalanceResult,
  KrakenOpenPositionResult,
  KrakenOpenOrderResult,
  KrakenOrderResult,
  KrakenOrderResponse,
} from '../models/kraken/KrakenResults';

class KrakenService {
  kraken: any; // krakenApi

  constructor(kraken: any) {
    this.kraken = kraken;
  }

  async getPair(krakenTicker: string): Promise<KrakenTradeablePairResult> {
    return new KrakenTradeablePairResult(
      await this.kraken.getTradableAssetPairs({
        pair: krakenTicker,
      })
    );
  }

  async getPrice(krakenTicker: string): Promise<KrakenPriceResult> {
    return new KrakenPriceResult(
      await this.kraken.getTickerInformation({
        pair: krakenTicker,
      })
    );
  }

  async getBalance(): Promise<KrakenBalanceResult> {
    return new KrakenBalanceResult(await this.kraken.getBalance());
  }

  async getOpenOrders(): Promise<KrakenOpenOrderResult> {
    return new KrakenOpenOrderResult(await this.kraken.getOpenOrders());
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

  // async setAddOrder() {}

  async cancelOpenOrdersForPair(order: KrakenOrderDetails, opposite = true) {
    const open = order.openOrders?.open;

    if (!open) return;

    let result;
    for (const key in open) {
      const pair = open[key]['descr']['pair'];
      const type = open[key]['descr']['type'];
      const action = opposite ? order.oppositeAction : order.action;

      if (pair === order.krakenizedTradingViewTicker && type === action) {
        console.log(`Canceling ${type} order`);
        result = await this.kraken.setCancelOrder({ txid: key });
      }
    }

    return result;
  }

  async openOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse | undefined> {
    // some orders might not have filled. cancel beforehand
    await this.cancelOpenOrdersForPair(order);

    let result;
    if (order.noLeverage) {
      result = await this.handleNonLeveragedOrder(order);
    } else if (order.bagIt) {
      result = await this.handleBags(order);
    } else {
      result = await this.handleLeveragedOrder(order);
    }

    return result;
  }

  async settleLeveragedOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    const { openPositions } = await this.getOpenPositions();

    // cancel open add order for this run. Some might not have been picked up
    await this.cancelOpenOrdersForPair(order);

    let latestResult;
    if (order.txId) {
      // close out specific transaction only (at least the value of it since we can't specify closing by id)
      // we do not break the for loop after close because there may be 2 or more orders filled in a transaction
      for (const key in openPositions) {
        const position = openPositions[key];
        if (position.pair === order.krakenTicker && position.ordertxid === order.txId) {
          const closeAction = position.type === 'sell' ? 'buy' : 'sell';
          const volumeToClose = parseFloat(position.vol) - parseFloat(position.vol_closed);
          latestResult = await this.kraken.setAddOrder({
            pair: order.krakenTicker,
            type: closeAction,
            ordertype: 'limit',
            price: order.bidPrice,
            volume: volumeToClose,
            leverage: order.leverageAmount,
            // validate: true,
          });
          logOrderResult(`Settled Position`, latestResult, order.krakenizedTradingViewTicker);
        }
      }
    } else {
      for (const key in openPositions) {
        const position = openPositions[key];
        if (position.pair === order.krakenTicker && order.action !== position.type) {
          const closeAction = position.type === 'sell' ? 'buy' : 'sell';
          latestResult = await this.kraken.setAddOrder({
            pair: order.krakenTicker,
            type: closeAction,
            ordertype: 'limit',
            price: order.bidPrice,
            volume: 0, // 0 for close all
            leverage: order.leverageAmount,
            // validate: true,
          });
          logOrderResult(`Settled Position`, latestResult, order.krakenizedTradingViewTicker);
          break;
        }
      }
    }

    if (!latestResult) {
      console.log('Leveraged Order: Nothing to close');
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
      let positionMargin = 0;
      // totalPosition = 0;
      for (const key in openPositions) {
        const position = openPositions[key];
        if (order.krakenTicker === position.pair && order.action === position.type) {
          add = true;
          positionMargin += parseFloat(position.margin);
          // totalPosition += parseFloat(position.cost);
          // console.log(
          //   `Adding ${order.krakenizedTradingViewTicker}, My Margin: ${positionMargin}, Total Position: ${totalPosition}`
          // );
        } else if (order.krakenTicker === position.pair && order.action !== position.type) {
          console.log("Opposite Order, Should've Closed?", order.krakenizedTradingViewTicker);
          await this.settleLeveragedOrder(order);
        }
      }

      if (add) {
        console.log(`Current Margin: ${positionMargin.toFixed(2)}`);
        console.log(`Margin After: ${(positionMargin + order.addSize).toFixed(2)}`);
        console.log(`Total Allowed: ${order.maxVolumeInDollar}`);
        const tooMuch = order.entrySize
          ? positionMargin >= order.maxVolumeInDollar
          : positionMargin >= 175;

        if (!tooMuch) {
          const addCount =
            parseInt(((Math.floor(positionMargin) - order.entrySize) / order.addSize).toFixed(0)) +
            1;
          const incrementalAddVolume = (order.addVolume * (1 + addCount * 0.01)).toFixed(
            order.volumeDecimals
          );
          const incrementalAddDollar = (order.addSize * (1 + addCount * 0.01)).toFixed(2);
          console.log(`Adding ${addCount}/${order.addCount}: ${order.addSize}`);
          console.log(`Original: ${order.addSize}, Incremental: ${incrementalAddDollar}`);
          result = await this.kraken.setAddOrder({
            pair: order.krakenTicker,
            type: order.action,
            ordertype: 'limit',
            // ordertype: 'market',
            price: order.bidPrice,
            volume: incrementalAddVolume,
            leverage: order.leverageAmount,
            // validate: true,
          });
        } else {
          console.log('Easy there buddy');
        }
      } else if (!add) {
        console.log(`New Entry: ${order.tradeVolumeInDollar} @ ${order.leverageAmount}:1 leverage`);
        result = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: order.action,
          ordertype: 'limit',
          price: order.bidPrice,
          volume: order.tradeVolume,
          leverage: order.leverageAmount,
          // validate: true,
        });
      }

      logOrderResult(`Leveraged Order`, result, order.krakenizedTradingViewTicker);
    }

    return result;
  }

  async handleNonLeveragedOrder(order: KrakenOrderDetails): Promise<KrakenOrderResponse> {
    let result;
    if (order.action === 'sell') {
      if (isNaN(order.balanceOfBase) || order.balanceOfBase < 1e-5) {
        result = new KrakenOrderResult({
          error: [`${order.action.toUpperCase()} balance is too small`],
        });
      } else {
        console.log(order.sellBags ? `Selling Bags` : `Selling ${order.balanceInDollar}`);
        result = await this.kraken.setAddOrder({
          pair: order.krakenTicker,
          type: order.action,
          ordertype: 'limit',
          price: order.bidPrice,
          volume: order.tradeVolume,
          // validate: true,
        });
      }
    } else {
      if (order.balanceInDollar < order.maxVolumeInDollar || order.buyBags) {
        if (order.balanceOfBase < 1e-5) {
          console.log(`New Entry: ${order.tradeVolumeInDollar}`);
          result = await this.kraken.setAddOrder({
            pair: order.krakenTicker,
            type: order.action,
            ordertype: 'limit',
            price: order.bidPrice,
            volume: order.tradeVolume,
            // validate: true,
          });
        } else {
          console.log(`Current Balance: ${order.balanceInDollar.toFixed(2)}`);
          console.log(`Balance After: ${(order.balanceInDollar + order.addSize).toFixed(2)}`);
          console.log(`Total Allowed: ${order.maxVolumeInDollar}`);
          console.log(
            order.buyBags
              ? 'Buying Bags'
              : `Adding ${
                  parseInt(
                    ((Math.floor(order.balanceInDollar) - order.entrySize) / order.addSize).toFixed(
                      0
                    )
                  ) + 1
                }/${order.addCount}: ${order.addSize}`
          );
          result = await this.kraken.setAddOrder({
            pair: order.krakenTicker,
            type: order.action,
            ordertype: 'limit',
            price: order.bidPrice,
            volume: order.buyBags ? order.tradeVolume : order.addVolume,
            // validate: true,
          });
        }
      } else {
        console.log(
          `Position size for ${order.krakenizedTradingViewTicker} is too large ${order.balanceInDollar}`
        );
      }
    }

    logOrderResult(`Non Leveraged Order`, result, order.krakenizedTradingViewTicker);
    return result;
  }

  async handleBags(order: KrakenOrderDetails): Promise<KrakenOrderResponse | undefined> {
    let tradeVolumeInDollar, result;

    // local meaning don't close leverage orders
    if (!order.nonLeverageOnly) {
      result = await this.handleLeveragedOrder(order);
      logOrderResult(`Leveraged Order`, result, order.krakenizedTradingViewTicker);
    }

    if (order.buyBags) {
      // buy 40% worth of my usd available
      // currently morphing original order. Sorry immutability
      const bagAmount = order.bagAmount ? order.bagAmount : 0.4;
      tradeVolumeInDollar = order.superParseFloat(
        order.balanceOfQuote * bagAmount,
        order.volumeDecimals
      );
    } else {
      // sell 80% worth of currency available
      const bagAmount = order.bagAmount ? order.bagAmount : 0.75;
      tradeVolumeInDollar = order.superParseFloat(
        order.balanceOfBase * order.usdValueOfBase * bagAmount,
        order.volumeDecimals
      );
    }

    let volumeTradedInDollar = 0;
    let i = 0;
    while (volumeTradedInDollar < tradeVolumeInDollar) {
      order.tradeVolume =
        order.marginFree < tradeVolumeInDollar
          ? order.superParseFloat(
              (order.marginFree * 0.8) / order.usdValueOfBase,
              order.volumeDecimals
            )
          : tradeVolumeInDollar / order.usdValueOfBase;
      volumeTradedInDollar += order.tradeVolume * order.usdValueOfBase;
      if (order.tradeVolume < order.minVolume) break;
      if (i > 8) {
        console.log(`Something went wrong buying bags, canceling`);
        volumeTradedInDollar = tradeVolumeInDollar;
      }

      // no way of knowing when the leveraged order is filled, so we'll wait
      setTimeout(async () => {
        // update bid price
        const { price } = await kraken.getPrice(order.krakenTicker);
        const currentBid = order.superParseFloat(
          price[order.krakenTicker]['b'][0],
          order.priceDecimals
        );
        const currentAsk = order.superParseFloat(
          price[order.krakenTicker]['a'][0],
          order.priceDecimals
        );
        order.bidPrice = order.action === 'buy' ? currentAsk : currentBid;

        // order
        result = await this.handleNonLeveragedOrder(order);
        console.log('-'.repeat(20));
      }, 15000 * i);
      i++;
    }
    return result;
  }

  async balancePortfolio() {
    const { balances } = await this.getBalance();
    console.log('USD Balance Before Rebalance:', balances['ZUSD']);

    const { openPositions } = await this.getOpenPositions();

    let longEthBtc, longBtcUsd, longEthUsd;
    for (const key in openPositions) {
      const pair = openPositions[key]['pair'];
      const type = openPositions[key]['type'];

      if (pair === 'XETHXXBT') {
        longEthBtc = type === 'buy';
      } else if (pair === 'XXBTZUSD') {
        longBtcUsd = type === 'buy';
      } else if (pair === 'XETHZUSD') {
        longEthUsd = type === 'buy';
      }
    }

    // if (longEthBtc && longBtcUsd) {

    // } else if () {

    // }

    console.log(longEthBtc, longBtcUsd, longEthUsd);

    return balances;
  }
}

const krakenApi = new Kraken(process.env.KRAKEN_API_KEY, process.env.KRAKEN_SECRET_KEY);
export const kraken = new KrakenService(krakenApi);

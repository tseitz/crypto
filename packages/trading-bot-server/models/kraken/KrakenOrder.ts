interface KrakenOrderProps {
  pair: string;
  krakenizedPair: string;
  type: "buy" | "sell";
  ordertype: "market" | "limit";
  price: number;
  volume: number;
  leverage?: number;
}

export class KrakenOrder {
  pair: string;
  krakenizedPair: string;
  type: "buy" | "sell";
  ordertype: "market" | "limit";
  price: number;
  volume: number;
  leverage?: number;

  constructor(attrs: KrakenOrderProps, switchType?: "market" | "limit") {
    this.pair = attrs.pair;
    this.krakenizedPair = attrs.krakenizedPair;
    this.type = attrs.type;
    this.ordertype = switchType ? switchType : attrs.ordertype;
    this.price = attrs.price;
    this.volume = attrs.volume;
    this.leverage = attrs.leverage;
  }

  orderify() {
    if (this.leverage) {
      return {
        pair: this.pair,
        type: this.type,
        ordertype: this.ordertype,
        price: this.price,
        volume: this.volume,
        leverage: this.leverage,
        // validate: true,
      };
    } else {
      return {
        pair: this.pair,
        type: this.type,
        ordertype: this.ordertype,
        price: this.price,
        volume: this.volume,
        // validate: true,
      };
    }
  }
}

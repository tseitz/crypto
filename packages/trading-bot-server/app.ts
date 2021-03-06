import express from "express";
import cors from "cors";
import schedule from "node-schedule";
import { KrakenWebhookOrder } from "./models/kraken/KrakenWebhookOrder";
import { BinanceWebhookOrder } from "./models/binance/BinanceWebhookOrder";
import { GeminiWebhookOrder } from "./models/gemini/GeminiWebhookOrder";
import { kraken } from "./services/krakenService";
// import { handleUniswapOrder } from './services/uniswapService';
import { KrakenTradingViewBody } from "./models/TradingViewBody";
import { OrderQueue } from "./models/OrderQueue";
import { logNightlyResult } from "./services/mongoDbService";
import { logBreak } from "./scripts/common";

const PORT = process.env.PORT || 3000;

const app = express();

const corsOptions = {
  origin: "http://localhost:5000",
};

// create application/json parser
const jsonParser = express.json();
app.use(jsonParser, cors(corsOptions));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const queue: OrderQueue[] = [];
let krakenLocked = false;
let locked = {
  kraken: false,
  binance: false,
  gemini: false,
};

app.post("/webhook/kraken", jsonParser, async (req, res) => {
  // force body to be JSON
  const body: KrakenTradingViewBody = JSON.parse(JSON.stringify(req.body));
  if (!body || body.passphrase !== process.env.TRADING_VIEW_PASSPHRASE) {
    console.log("Hey buddy, get out of here", req.body);
    logBreak();
    return res.send("Hey buddy, get out of here");
  }

  // queue it
  queue.push({ body, res });
  if (krakenLocked === true) return;

  while (queue.length > 0) {
    krakenLocked = true;
    const request = queue.shift();
    if (request) {
      console.log(
        "KRAKEN",
        request.body.ticker,
        request.body.strategy.action,
        request.body.strategy.description
      );
      const order = new KrakenWebhookOrder(request.body);
      try {
        request.res.send(await order.placeOrder());
      } catch (error) {
        console.log(error);
        krakenLocked = false;
      }
    }
    logBreak();
    krakenLocked = false;
  }
  return;
});

app.post("/webhook/binance", jsonParser, async (req, res) => {
  // force body to be JSON
  const body: KrakenTradingViewBody = JSON.parse(JSON.stringify(req.body));
  if (!body || body.passphrase !== process.env.TRADING_VIEW_PASSPHRASE) {
    console.log("Hey buddy, get out of here", req.body);
    logBreak();
    return res.send("Hey buddy, get out of here");
  }

  // queue it
  queue.push({ body, res });
  if (locked.binance === true) return;

  while (queue.length > 0) {
    locked.binance = true;
    const request = queue.shift();
    if (request) {
      console.log(
        "BINANCE",
        request.body.ticker,
        request.body.strategy.action,
        request.body.strategy.description
      );
      const order = new BinanceWebhookOrder(request.body);
      try {
        request.res.send(await order.placeOrder());
      } catch (error) {
        console.log(error);
        locked.binance = false;
      }
    }
    logBreak();
    locked.binance = false;
  }
  return;
});

app.post("/webhook/gemini", jsonParser, async (req, res) => {
  // force body to be JSON
  const body: KrakenTradingViewBody = JSON.parse(JSON.stringify(req.body));
  if (!body || body.passphrase !== process.env.TRADING_VIEW_PASSPHRASE) {
    console.log("Hey buddy, get out of here", req.body);
    logBreak();
    return res.send("Hey buddy, get out of here");
  }

  // queue it
  queue.push({ body, res });
  if (locked.gemini === true) return;

  while (queue.length > 0) {
    locked.gemini = true;
    const request = queue.shift();
    if (request) {
      console.log(
        "GEMINI",
        request.body.ticker,
        request.body.strategy.action,
        request.body.strategy.description
      );
      const order = new GeminiWebhookOrder(request.body);
      try {
        request.res.send(await order.placeOrder());
      } catch (error) {
        console.log(error);
        locked.gemini = false;
      }
    }
    logBreak();
    locked.gemini = false;
  }
  return;
});

app.get("/api/kraken/getOpenPositions", jsonParser, async (req, res) => {
  res.json(await kraken.getOpenPositions());
});

app.get("/api/kraken/getBalance", jsonParser, async (req, res) => {
  res.json(await kraken.getBalance());
});

app.get("/api/kraken/getTradeBalance", jsonParser, async (req, res) => {
  res.json(await kraken.getTradeBalance());
});

// app.post('/webhook/uniswap', jsonParser, async (req, res) => {
//   // force body to be JSON
//   const requestBody: TradingViewBody = JSON.parse(JSON.stringify(req.body));
//   if (!requestBody || requestBody.passphrase !== process.env.TRADING_VIEW_PASSPHRASE) {
//     console.log('Hey buddy, get out of here');
//     return res.send('Hey buddy, get out of here');
//   }

//   const blockNumberMined = await handleUniswapOrder(requestBody);
//   return res.send(blockNumberMined);
// });

app.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on port ${PORT}`);
  if (PORT === 3000) {
    console.log(`Here ya go http://localhost:${PORT}`);
  } else {
    console.log(`Hi Heroku`);
  }
});

const cronNoon = schedule.scheduleJob("0 12 * * *", async () => {
  getBalances();
});
const cronMidnight = schedule.scheduleJob("0 0 * * *", async () => {
  getBalances();
});

async function getBalances() {
  const balances = await kraken.getTradeBalance();
  const realizedBalance = balances.totalBalances;
  const unrealizedGains = balances.unrealizedGains;
  const unrealizedBalance =
    parseFloat(realizedBalance) + parseFloat(unrealizedGains);

  console.log(`Nightly Log
--------------------------
  Balance:      $${realizedBalance}
  Open:         $${unrealizedGains}
  Unrealized:   $${unrealizedBalance.toFixed(4)}
--------------------------`);

  await logNightlyResult(balances);
}
// getBalances();

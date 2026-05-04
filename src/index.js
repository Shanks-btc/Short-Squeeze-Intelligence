require("dotenv").config();

const express = require("express");
const { createContextMiddleware } = require("@ctxprotocol/sdk");
const { getShortInterest, getThresholdList, getDailyShortVolume } = require("./services/finra");
const { getStockData, getShortData } = require("./services/yahoo");
const {
  computeSqueezeScore,
  computeCostToBorrowScore,
  computeShortInterestPct,
  computeDaysToCover
} = require("./utils/scoring");

const app = express();
app.use(express.json());
//app.use(createContextMiddleware());

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticker: { type: "string", description: "Stock ticker symbol" },
    squeezeRiskScore: { type: "number", description: "Composite squeeze risk score 0-100" },
    regime: { type: "string", description: "Risk regime: Low, Moderate, High, or Critical" },
    shortInterestPct: { type: ["number", "null"], description: "Short interest as percentage of float" },
    daysToCover: { type: ["number", "null"], description: "Days to cover based on avg daily volume" },
    costToBorrowScore: { type: "number", description: "Estimated cost to borrow score 0-100" },
    onThresholdList: { type: "boolean", description: "Whether stock is on FINRA threshold list" },
    shortVolRatio: { type: ["number", "null"], description: "Short volume as ratio of total volume" },
    currentPrice: { type: ["number", "null"], description: "Current stock price in USD" },
    avgVolume30d: { type: ["number", "null"], description: "30-day average daily volume" },
    impliedAction: { type: "string", description: "Implied trading action based on squeeze risk" },
    sourceRefs: { type: "array", items: { type: "string" }, description: "Data source references" },
    asOf: { type: "string", description: "Data freshness date" },
    confidence: { type: "number", description: "Confidence score 0-1" },
    freshnessNote: { type: "string", description: "Data freshness explanation" }
  },
  required: ["ticker", "squeezeRiskScore", "regime", "asOf"]
};

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    ticker: {
      type: "string",
      description: "Stock ticker symbol to analyze for squeeze risk",
      default: "CVNA",
      examples: ["CVNA", "GME", "MSTR", "BBBY", "AMC"]
    }
  },
  required: ["ticker"]
};

const COMPARE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    ticker1: {
      type: "string",
      description: "First stock ticker symbol",
      default: "CVNA",
      examples: ["CVNA", "GME", "MSTR"]
    },
    ticker2: {
      type: "string",
      description: "Second stock ticker symbol",
      default: "GME",
      examples: ["GME", "AMC", "BBBY"]
    }
  },
  required: ["ticker1", "ticker2"]
};

const TOOLS = [
  {
    name: "get_squeeze_risk",
    description: "Returns a composite squeeze risk score 0-100 for any US-listed stock based on FINRA short interest, threshold list status, days to cover, and short volume ratio. Answers: Is this stock setting up for a short squeeze?",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA
  },
  {
    name: "get_short_interest",
    description: "Returns current short interest data including short interest percentage of float, days to cover, and 7-day delta for any US-listed stock from FINRA official data.",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA
  },
  {
    name: "get_cost_to_borrow",
    description: "Returns estimated cost to borrow score based on FINRA threshold list status and short volume ratio. High score indicates expensive or difficult to borrow shares.",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA
  },
  {
    name: "compare_squeeze_risk",
    description: "Compares squeeze risk scores between two US-listed stocks side by side to identify which has the stronger squeeze setup.",
    inputSchema: COMPARE_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      properties: {
        ticker1: { type: "object", description: "Squeeze data for first ticker" },
        ticker2: { type: "object", description: "Squeeze data for second ticker" },
        verdict: { type: "string", description: "Comparative verdict on which has stronger squeeze setup" },
        asOf: { type: "string", description: "Data freshness date" }
      },
      required: ["ticker1", "ticker2", "verdict", "asOf"]
    }
  },
  {
    name: "get_short_interest_trend",
    description: "Returns the short interest trend for a stock - whether short interest is increasing or decreasing and what that implies for squeeze probability.",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA
  }
];

async function getSqueezeData(ticker) {
  const symbol = ticker.toUpperCase();

  const [shortData, thresholdData, dailyData, stockData, shortInterestData] = await Promise.allSettled([
    getShortInterest(symbol),
    getThresholdList(symbol),
    getDailyShortVolume(symbol),
    getStockData(symbol),
    getShortData(symbol)
  ]);

  const shortRecords = shortData.status === "fulfilled" ? shortData.value : [];
  const onThresholdList = thresholdData.status === "fulfilled" ? thresholdData.value : false;
  const dailyRecords = dailyData.status === "fulfilled" ? dailyData.value : [];
  const stock = stockData.status === "fulfilled" ? stockData.value : null;
  const siData = shortInterestData.status === "fulfilled" ? shortInterestData.value : null;

  // Parse FINRA short interest records
  let totalShortShares = null;
  let prevShortShares = null;
  let avgVolumeFromFINRA = null;

  if (Array.isArray(shortRecords) && shortRecords.length > 0) {
    const latest = shortRecords[0];
    totalShortShares = parseFloat(latest.currentShortPositionQuantity) || null;
    prevShortShares = parseFloat(latest.previousShortPositionQuantity) || null;
    if (latest.averageDailyVolumeQuantity) {
      avgVolumeFromFINRA = parseFloat(latest.averageDailyVolumeQuantity) || null;
    }
  }

  // Use StockAnalysis data as primary source for short interest
  const shortInterestShares = siData?.shortInterest || totalShortShares;
  const prevShortFromSA = siData?.shortPrior || prevShortShares;
  const floatShares = siData?.floatShares || stock?.sharesFloat || stock?.sharesOutstanding || null;
  const avgVolume = stock?.avgVolume30d || avgVolumeFromFINRA || null;
  const currentPrice = stock?.currentPrice || null;

  // Short interest percentage from StockAnalysis or calculated
  const shortInterestPct = siData?.shortFloat || computeShortInterestPct(shortInterestShares, floatShares);

  // Days to cover from StockAnalysis or calculated
  const daysToCover = siData?.shortRatio || computeDaysToCover(shortInterestShares, avgVolume);

  // Short volume ratio from regSho data
  let shortVolRatio = null;
  if (Array.isArray(dailyRecords) && dailyRecords.length > 0) {
    const latest = dailyRecords[0];
    const shortVol = parseFloat(latest.shortParQuantity) || 0;
    const totalVol = parseFloat(latest.totalParQuantity) || 0;
    shortVolRatio = totalVol > 0 ? Math.round((shortVol / totalVol) * 100) / 100 : null;
  }

  const costToBorrowScore = computeCostToBorrowScore(onThresholdList, shortVolRatio);

  // Delta calculation capped at +/- 100%
  let shortInterestDelta7d = 0;
  const currentSI = shortInterestShares;
  const prevSI = prevShortFromSA;
  if (currentSI && prevSI && prevSI > 0) {
    const rawDelta = ((currentSI - prevSI) / prevSI) * 100;
    shortInterestDelta7d = Math.round(Math.max(-100, Math.min(100, rawDelta)) * 10) / 10;
  }

  const { squeezeRiskScore, regime, impliedAction } = computeSqueezeScore(
    shortInterestPct,
    costToBorrowScore,
    daysToCover,
    shortInterestDelta7d
  );

  return {
    ticker: symbol,
    squeezeRiskScore,
    regime,
    shortInterestPct,
    daysToCover,
    costToBorrowScore,
    onThresholdList,
    shortVolRatio,
    currentPrice,
    avgVolume30d: avgVolume,
    shortInterestDelta7d,
    impliedAction,
    sourceRefs: [
      "StockAnalysis.com - Short Interest Data (Finviz fallback)",
      "FINRA Threshold List - api.finra.org",
      "FINRA Reg SHO Daily - api.finra.org",
      "Yahoo Finance - query1.finance.yahoo.com"
    ],
    asOf: new Date().toISOString().split("T")[0],
    confidence: shortInterestPct ? 0.90 : 0.50,
    freshnessNote: "Short interest from StockAnalysis (Finviz fallback) updated bi-weekly per FINRA schedule. Daily short volume ratio from FINRA regSho updated each trading day. Cost to borrow score derived from FINRA threshold list - official regulatory signal for hard-to-borrow securities."
  };
}

function formatSqueezeText(data) {
  return `Squeeze Risk: ${data.regime} (Score: ${data.squeezeRiskScore}/100)
Ticker: ${data.ticker} | Price: $${data.currentPrice?.toFixed(2) || "N/A"}
Short Interest: ${data.shortInterestPct?.toFixed(2) || "N/A"}% of float
Days to Cover: ${data.daysToCover?.toFixed(2) || "N/A"}
Cost to Borrow Score: ${data.costToBorrowScore}/100
On FINRA Threshold List: ${data.onThresholdList ? "Yes - Very Hard to Borrow" : "No"}
Short Volume Ratio: ${data.shortVolRatio ? (data.shortVolRatio * 100).toFixed(1) + "%" : "N/A"}
Short Interest Delta 7d: ${data.shortInterestDelta7d > 0 ? "+" : ""}${data.shortInterestDelta7d || 0}%
Action: ${data.impliedAction}
Data as of: ${data.asOf}
Note: ${data.freshnessNote}`;
}

app.get("/", (req, res) => {
  res.json({ status: "ok", name: "short-squeeze-intelligence", version: "1.0.0" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/mcp", async (req, res) => {
  const body = req.body;
  res.setHeader("Content-Type", "text/event-stream");

  const sendEvent = (data) => {
    res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  };

  try {
    if (body.method === "initialize") {
      return sendEvent({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "short-squeeze-intelligence", version: "1.0.0" }
        }
      });
    }

    if (body.method === "tools/list") {
      return sendEvent({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: TOOLS }
      });
    }

    if (body.method === "tools/call") {
      const toolName = body.params?.name;
      const args = body.params?.arguments || {};

      if (toolName === "compare_squeeze_risk") {
        const [data1, data2] = await Promise.all([
          getSqueezeData(args.ticker1 || "CVNA"),
          getSqueezeData(args.ticker2 || "GME")
        ]);

        const verdict = data1.squeezeRiskScore > data2.squeezeRiskScore
          ? `${data1.ticker} has stronger squeeze setup (${data1.squeezeRiskScore} vs ${data2.squeezeRiskScore})`
          : data2.squeezeRiskScore > data1.squeezeRiskScore
          ? `${data2.ticker} has stronger squeeze setup (${data2.squeezeRiskScore} vs ${data1.squeezeRiskScore})`
          : `${data1.ticker} and ${data2.ticker} have equal squeeze risk (${data1.squeezeRiskScore})`;

        const compareResult = {
          ticker1: data1,
          ticker2: data2,
          verdict,
          asOf: new Date().toISOString().split("T")[0]
        };

        return sendEvent({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: compareResult,
            content: [{
              type: "text",
              text: `Squeeze Risk Comparison:\n\n${data1.ticker}:\n${formatSqueezeText(data1)}\n\n${data2.ticker}:\n${formatSqueezeText(data2)}\n\nVerdict: ${verdict}`
            }]
          }
        });
      }

      const ticker = args.ticker || "CVNA";
      const data = await getSqueezeData(ticker);

      return sendEvent({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: data,
          content: [{
            type: "text",
            text: formatSqueezeText(data)
          }]
        }
      });
    }

    sendEvent({ jsonrpc: "2.0", id: body.id, result: {} });

  } catch (error) {
    sendEvent({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32603, message: error.message }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Short Squeeze Intelligence MCP Server running on port ${PORT}`);
  // Pre-warm cache in background - non-blocking
  setTimeout(() => {
    const warmTickers = [
      "CVNA", "GME", "AMC", "MSTR", "BBBY", "RIVN", "LCID",
      "SOFI", "PLTR", "NIO", "TLRY", "SNDL", "CLOV", "SPCE",
      "RIDE", "WKHS", "NKLA", "GOEV", "BLNK", "CHPT", "HYLN",
      "AGEN", "BFRI", "HIMS", "IDEX", "JMIA", "KPLT", "LMND",
      "MVIS", "OPEN", "PTRA", "ROOT", "SMAR", "TPVG", "UPST",
      "VUZI", "XELA", "XTLB", "ZNGA", "WISH", "PSFE", "MVST",
      "ACTC", "PAYA", "VVPR", "FTIV", "GFAI", "BOXL", "EARS", "EVFM"
    ];
    // Warm one ticker every 10 seconds to avoid rate limiting
    warmTickers.forEach((ticker, index) => {
      setTimeout(() => {
        getSqueezeData(ticker)
          .then(() => console.log(`Cache warmed: ${ticker}`))
          .catch(err => console.log(`Cache warm failed ${ticker}:`, err.message));
      }, index * 10000);
    });
  }, 5000); // Wait 5 seconds after startup before warming
});

module.exports = app;

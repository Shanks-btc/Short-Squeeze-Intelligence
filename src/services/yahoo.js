const axios = require("axios");
const { createClient } = require("redis");

let redisClient = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (err) => console.log("Redis error:", err.message));
    await redisClient.connect();
  }
  return redisClient;
}

async function getStockData(ticker) {
  const cacheKey = `yahoo_${ticker}`;
  const TTL = 3600;

  // Try cache first
  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  // Fetch fresh data
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
      {
        params: { interval: "1d", range: "30d" },
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      }
    );

    const result = response.data?.chart?.result?.[0];
    if (!result) throw new Error("No data from Yahoo Finance");

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const volumes = quotes?.volume || [];

    const validVolumes = volumes.filter(v => v != null);
    const avgVolume30d = validVolumes.length > 0
      ? validVolumes.reduce((a, b) => a + b, 0) / validVolumes.length
      : null;

    const data = {
      ticker: ticker.toUpperCase(),
      currentPrice: meta.regularMarketPrice || null,
      avgVolume30d,
      sharesFloat: meta.sharesFloat || null,
      sharesOutstanding: meta.sharesOutstanding || null,
      marketCap: meta.marketCap || null,
      asOf: new Date().toISOString().split("T")[0]
    };

    // Try to cache - never throw if it fails
    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(data));
    } catch (e) {
      console.log("Redis cache write skipped:", e.message);
    }

    return data;

  } catch (error) {
    // Return partial data instead of throwing
    console.log("Yahoo Finance error:", error.message);
    return {
      ticker: ticker.toUpperCase(),
      currentPrice: null,
      avgVolume30d: null,
      sharesFloat: null,
      sharesOutstanding: null,
      marketCap: null,
      asOf: new Date().toISOString().split("T")[0]
    };
  }
}

async function getShortDataFinviz(ticker) {
  const cacheKey = `finviz_${ticker}`;
  const TTL = 43200;

  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  try {
    const response = await axios.get(
      `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html"
        }
      }
    );

    const html = response.data;

    const shortInterestMatch = html.match(/Short Interest[^0-9]*([0-9,.]+[MBK]?)/);
    const shortFloatMatch = html.match(/Short Float[^0-9]*([0-9.]+%)/);
    const shortRatioMatch = html.match(/Short Ratio[^0-9]*([0-9.]+)/);

    const parseShortInterest = (val) => {
      if (!val) return null;
      const num = parseFloat(val.replace(/,/g, ""));
      if (val.includes("M")) return num * 1000000;
      if (val.includes("B")) return num * 1000000000;
      if (val.includes("K")) return num * 1000;
      return num;
    };

    const data = {
      ticker: ticker.toUpperCase(),
      shortInterest: shortInterestMatch ? parseShortInterest(shortInterestMatch[1]) : null,
      shortFloat: shortFloatMatch ? parseFloat(shortFloatMatch[1]) : null,
      shortRatio: shortRatioMatch ? parseFloat(shortRatioMatch[1]) : null,
      shortPrior: null,
      floatShares: null,
      asOf: new Date().toISOString().split("T")[0],
      source: "Finviz"
    };

    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(data));
    } catch (e) {}

    return data;

  } catch (error) {
    console.log("Finviz error:", error.message);
    return {
      ticker: ticker.toUpperCase(),
      shortInterest: null,
      shortFloat: null,
      shortRatio: null,
      shortPrior: null,
      floatShares: null,
      asOf: new Date().toISOString().split("T")[0],
      source: "Finviz-failed"
    };
  }
}

async function getShortData(ticker) {
  const cacheKey = `shortdata_${ticker}`;
  const TTL = 43200;

  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  try {
    const response = await axios.get(
      `https://stockanalysis.com/stocks/${ticker.toLowerCase()}/statistics/`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html"
        }
      }
    );

    const html = response.data;

    // Fixed regex patterns - StockAnalysis uses unquoted keys
    const shortInterestMatch = html.match(/id:"shortInterest"[^}]*hover:"([^"]+)"/);
    const shortFloatMatch = html.match(/id:"shortFloat"[^}]*hover:"([^"]+)"/);
    const shortRatioMatch = html.match(/id:"shortRatio"[^}]*hover:"([^"]+)"/);
    const shortPriorMatch = html.match(/id:"shortPriorMonth"[^}]*hover:"([^"]+)"/);
    const floatMatch = html.match(/id:"float"[^}]*hover:"([^"]+)"/);

    const shortInterest = shortInterestMatch
      ? parseFloat(shortInterestMatch[1].replace(/,/g, ""))
      : null;
    const shortFloat = shortFloatMatch
      ? parseFloat(shortFloatMatch[1].replace("%", ""))
      : null;
    const shortRatio = shortRatioMatch
      ? parseFloat(shortRatioMatch[1])
      : null;
    const shortPrior = shortPriorMatch
      ? parseFloat(shortPriorMatch[1].replace(/,/g, ""))
      : null;
    const floatShares = floatMatch
      ? parseFloat(floatMatch[1].replace(/,/g, ""))
      : null;

    // If StockAnalysis returned nulls fall back to Finviz
    if (!shortFloat && !shortRatio) {
      console.log(`StockAnalysis returned nulls for ${ticker} - falling back to Finviz`);
      return await getShortDataFinviz(ticker);
    }

    const data = {
      ticker: ticker.toUpperCase(),
      shortInterest,
      shortFloat,
      shortRatio,
      shortPrior,
      floatShares,
      asOf: new Date().toISOString().split("T")[0],
      source: "StockAnalysis"
    };

    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(data));
    } catch (e) {}

    return data;

  } catch (error) {
    console.log(`StockAnalysis error for ${ticker}: ${error.message} - falling back to Finviz`);
    return await getShortDataFinviz(ticker);
  }
}

module.exports = { getStockData, getShortData, getShortDataFinviz };
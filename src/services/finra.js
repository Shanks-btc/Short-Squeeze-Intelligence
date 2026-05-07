const axios = require("axios");

let redisClient = null;
let redisConnected = false;

async function initRedis() {
  try {
    const { createClient } = require("redis");
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => {
          if (retries > 2) { redisConnected = false; return false; }
          return 1000;
        }
      }
    });
    redisClient.on("error", () => { redisConnected = false; });
    redisClient.on("connect", () => { redisConnected = true; });
    await redisClient.connect();
    redisConnected = true;
  } catch (e) {
    redisConnected = false;
  }
}

initRedis();

async function cacheGet(key) {
  if (!redisConnected || !redisClient) return null;
  try {
    const val = await redisClient.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) { return null; }
}

async function cacheSet(key, value, ttl) {
  if (!redisConnected || !redisClient) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(value));
  } catch (e) {}
}

async function getShortInterest(ticker) {
  const cacheKey = `finra_short_${ticker}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.post(
      "https://api.finra.org/data/group/otcmarket/name/consolidatedShortInterest",
      {
        limit: 3,
        compareFilters: [{
          fieldName: "symbolCode",
          fieldValue: ticker.toUpperCase(),
          compareType: "equal"
        }]
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );
    await cacheSet(cacheKey, response.data, 43200);
    return response.data;
  } catch (error) {
    throw new Error(`FINRA short interest error: ${error.message}`);
  }
}

async function getThresholdList(ticker) {
  const cacheKey = `finra_threshold_${ticker}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) return cached;

  try {
    // Use POST with body for proper ticker filtering
    const response = await axios.post(
      "https://api.finra.org/data/group/OTCMarket/name/thresholdList",
      {
        limit: 10,
        compareFilters: [{
          fieldName: "issueSymbolIdentifier",
          fieldValue: ticker.toUpperCase(),
          compareType: "equal"
        }]
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    // Only true if response has records matching this specific ticker
    const records = response.data;
    const onList = Array.isArray(records) && records.length > 0 &&
      records.some(r =>
        r.issueSymbolIdentifier?.toUpperCase() === ticker.toUpperCase() ||
        r.symbolCode?.toUpperCase() === ticker.toUpperCase()
      );

    await cacheSet(cacheKey, onList, 43200);
    return onList;
  } catch (error) {
    return false;
  }
}

async function getDailyShortVolume(ticker) {
  const cacheKey = `finra_daily_${ticker}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Use POST with body for proper ticker filtering
    const response = await axios.post(
      "https://api.finra.org/data/group/OTCMarket/name/regShoDaily",
      {
        limit: 5,
        compareFilters: [{
          fieldName: "securitiesInformationProcessorSymbolIdentifier",
          fieldValue: ticker.toUpperCase(),
          compareType: "equal"
        }]
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    // Verify records match our ticker
    const records = Array.isArray(response.data)
      ? response.data.filter(r =>
          r.securitiesInformationProcessorSymbolIdentifier?.toUpperCase() === ticker.toUpperCase()
        )
      : [];

    await cacheSet(cacheKey, records, 3600);
    return records;
  } catch (error) {
    return [];
  }
}

module.exports = { getShortInterest, getThresholdList, getDailyShortVolume };

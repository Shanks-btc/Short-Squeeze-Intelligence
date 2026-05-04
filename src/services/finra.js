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

async function getShortInterest(ticker) {
  const cacheKey = `finra_short_${ticker}`;
  const TTL = 43200;

  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  try {
    const response = await axios.get(
      "https://api.finra.org/data/group/otcmarket/name/consolidatedShortInterest",
      {
        params: {
          limit: 5,
          compareFilters: JSON.stringify([{
            fieldName: "symbolCode",
            fieldValue: ticker.toUpperCase(),
            compareType: "equal"
          }]),
          sortFields: JSON.stringify([{
            fieldName: "settlementDate",
            sortType: "desc"
          }])
        },
        timeout: 10000,
        headers: { Accept: "application/json" }
      }
    );

    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(response.data));
    } catch (e) {}

    return response.data;
  } catch (error) {
    throw new Error(`FINRA short interest error: ${error.message}`);
  }
}

async function getThresholdList(ticker) {
  const cacheKey = `finra_threshold_${ticker}`;
  const TTL = 43200;

  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached !== null) return JSON.parse(cached);
  } catch (e) {}

  try {
    const response = await axios.get(
      "https://api.finra.org/data/group/OTCMarket/name/thresholdList",
      {
        params: {
          limit: 10,
          compareFilters: JSON.stringify([{
            fieldName: "issueSymbolIdentifier",
            fieldValue: ticker.toUpperCase(),
            compareType: "equal"
          }])
        },
        timeout: 10000,
        headers: { Accept: "application/json" }
      }
    );

    const onList = response.data && response.data.length > 0;

    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(onList));
    } catch (e) {}

    return onList;
  } catch (error) {
    return false;
  }
}

async function getDailyShortVolume(ticker) {
  const cacheKey = `finra_daily_${ticker}`;
  const TTL = 3600;

  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  try {
    const response = await axios.get(
      "https://api.finra.org/data/group/OTCMarket/name/regShoDaily",
      {
        params: {
          limit: 10,
          compareFilters: JSON.stringify([{
            fieldName: "securitiesInformationProcessorSymbolIdentifier",
            fieldValue: ticker.toUpperCase(),
            compareType: "equal"
          }])
        },
        timeout: 10000,
        headers: { Accept: "application/json" }
      }
    );

    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, TTL, JSON.stringify(response.data));
    } catch (e) {}

    return response.data;
  } catch (error) {
    return [];
  }
}

module.exports = { getShortInterest, getThresholdList, getDailyShortVolume };
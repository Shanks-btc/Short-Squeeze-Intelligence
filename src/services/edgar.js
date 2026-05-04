const axios = require("axios");

const cache = {};

async function getFloatData(ticker) {
  const cacheKey = `edgar_float_${ticker}`;
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000;

  if (cache[cacheKey] && now - cache[cacheKey].timestamp < TTL) {
    return cache[cacheKey].data;
  }

  try {
    // First get CIK from ticker
    const searchResponse = await axios.get(
      `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=2020-01-01&forms=10-K`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "ShortSqueezeIntelligence contact@example.com",
          Accept: "application/json"
        }
      }
    );

    // Get company facts for shares outstanding
    const companySearch = await axios.get(
      `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=10-K`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "ShortSqueezeIntelligence contact@example.com"
        }
      }
    );

    const result = { ticker, sharesOutstanding: null, float: null };
    cache[cacheKey] = { data: result, timestamp: now };
    return result;
  } catch (error) {
    if (cache[cacheKey]) return cache[cacheKey].data;
    return { ticker, sharesOutstanding: null, float: null };
  }
}

async function getSharesOutstanding(cik) {
  const cacheKey = `edgar_shares_${cik}`;
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000;

  if (cache[cacheKey] && now - cache[cacheKey].timestamp < TTL) {
    return cache[cacheKey].data;
  }

  try {
    const paddedCik = String(cik).padStart(10, "0");
    const response = await axios.get(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
      {
        timeout: 15000,
        headers: {
          "User-Agent": "ShortSqueezeIntelligence contact@example.com",
          Accept: "application/json"
        }
      }
    );

    const facts = response.data?.facts?.["us-gaap"];
    const sharesData = facts?.CommonStockSharesOutstanding?.units?.shares;

    if (sharesData && sharesData.length > 0) {
      const latest = sharesData[sharesData.length - 1];
      const shares = latest.val;
      cache[cacheKey] = { data: shares, timestamp: now };
      return shares;
    }

    return null;
  } catch (error) {
    if (cache[cacheKey]) return cache[cacheKey].data;
    return null;
  }
}

module.exports = { getFloatData, getSharesOutstanding };
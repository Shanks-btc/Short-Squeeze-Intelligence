function computeSqueezeScore(shortInterestPct, costToBorrowScore, daysToCover, shortInterestDelta7d) {
  const siScore = Math.min(shortInterestPct || 0, 100) * 0.35;
  const ctbScore = Math.min(costToBorrowScore || 0, 100) * 0.30;

  // Cap days to cover at 30 for scoring — anything above is data anomaly
  const safeDtc = daysToCover && daysToCover <= 30 ? daysToCover : 0;
  const dtcScore = Math.min(safeDtc * 10, 100) * 0.25;

  // Cap delta at 50% for scoring — anything above is data anomaly
  const safeDelta = Math.min(Math.abs(shortInterestDelta7d || 0), 50);
  const deltaScore = Math.min(safeDelta * 2, 100) * 0.10;

  const total = Math.round(siScore + ctbScore + dtcScore + deltaScore);

  const regime =
    total >= 76 ? "Critical" :
    total >= 51 ? "High" :
    total >= 26 ? "Moderate" : "Low";

  const impliedAction =
    regime === "Critical" ? "Very high squeeze probability - monitor closely for catalyst" :
    regime === "High" ? "Elevated squeeze risk - position sizing caution advised" :
    regime === "Moderate" ? "Moderate squeeze potential - watch for volume spikes" :
    "Low squeeze risk - insufficient short pressure for major squeeze";

  return { squeezeRiskScore: total, regime, impliedAction };
}

function computeCostToBorrowScore(onThresholdList, shortVolRatio) {
  if (onThresholdList) return 85;
  if (shortVolRatio >= 0.5) return 70;
  if (shortVolRatio >= 0.3) return 45;
  if (shortVolRatio >= 0.1) return 20;
  return 10;
}

function computeShortInterestPct(shortShares, sharesFloat) {
  if (!shortShares || !sharesFloat) return null;
  return Math.round((shortShares / sharesFloat) * 100 * 100) / 100;
}

function computeDaysToCover(shortShares, avgDailyVolume) {
  if (!shortShares || !avgDailyVolume) return null;
  const dtc = Math.round((shortShares / avgDailyVolume) * 100) / 100;
  // Return null if unrealistically high - likely data anomaly
  return dtc <= 100 ? dtc : null;
}

module.exports = {
  computeSqueezeScore,
  computeCostToBorrowScore,
  computeShortInterestPct,
  computeDaysToCover
};
require('dotenv').config();
const {createClient} = require('redis');
const client = createClient({url:process.env.REDIS_URL});
client.connect().then(async () => {await client.del('shortdata_CVNA');await client.del('yahoo_CVNA');await client.del('finra_short_CVNA');await client.del('finra_threshold_CVNA');await client.del('finra_daily_CVNA');console.log('Cache cleared');client.disconnect();});
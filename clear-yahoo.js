require('dotenv').config();
const {createClient} = require('redis');
const client = createClient({url:process.env.REDIS_URL});
client.connect().then(async () => {await client.del('yahoo_CVNA');console.log('Yahoo cache cleared');client.disconnect();});
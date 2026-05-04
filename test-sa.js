require('dotenv').config();
const axios = require('axios');
axios.get('https://stockanalysis.com/stocks/cvna/statistics/', {timeout:15000,headers:{'User-Agent':'Mozilla/5.0'}}).then(r => {console.log('Status:',r.status);console.log('Length:',r.data.length);console.log('Has shortFloat:',r.data.includes('shortFloat'));}).catch(e => console.log('Error:',e.message));
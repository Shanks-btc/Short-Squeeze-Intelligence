require('dotenv').config();
const axios = require('axios');
axios.get('https://stockanalysis.com/stocks/cvna/statistics/', {timeout:15000,headers:{'User-Agent':'Mozilla/5.0'}}).then(r => {const html = r.data;const idx = html.indexOf('shortFloat');console.log('shortFloat context:', html.substring(idx-5, idx+100));}).catch(e => console.log('Error:',e.message));
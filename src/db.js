const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

async function connect(uri = config.mongoUri) {
  await mongoose.connect(uri);
  console.log('[db] connected');
}

module.exports = { connect };

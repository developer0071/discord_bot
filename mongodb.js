const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']); 

const mongoose = require('mongoose');
require('dotenv').config(); 

// 1. Debug line to print the loaded connection string
console.log('Loaded connection string:', process.env.MONGODB_URI);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB successfully!'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));
const mongoose = require('mongoose');

const valueItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true, unique: true },
  rarity: { type: String, required: true },
  demand: { type: String },
  value: { type: String },
  rateOfChange: { type: String },
  taxGems: { type: String },
  taxGold: { type: String },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ValueItem', valueItemSchema);

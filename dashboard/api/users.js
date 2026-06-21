const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// GET all users
router.get('/all', async (req, res) => {
  try {
    const guildId = req.query.guildId;
    if (!guildId) return res.status(400).json({ error: 'guildId is required' });

    const db = admin.database();
    const snapshot = await db.ref(`guilds/${guildId}/users`).once('value');
    
    if (!snapshot.exists()) {
      return res.json([]);
    }

    const data = snapshot.val();
    const users = Object.entries(data).map(([userId, userData]) => ({
      userId,
      ...userData,
    }));

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

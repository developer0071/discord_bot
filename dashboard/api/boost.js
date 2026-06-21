const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Helper to write to audit log
async function logAudit(db, data) {
  const newLogRef = db.ref('audit-log').push();
  await newLogRef.set({
    timestamp: admin.database.ServerValue.TIMESTAMP,
    ...data
  });
}

// Calculate level from XP
function getLevelFromXp(xp) {
  if (xp < 0) return 0;
  const level = (-1 + Math.sqrt(1 + (4 * xp) / 50)) / 2;
  return Math.floor(level);
}

// POST boost
router.post('/:guildId/:userId/boost', async (req, res) => {
  try {
    const { guildId, userId } = req.params;
    const { xpAmount, adminId, adminName, reason } = req.body;
    
    if (!xpAmount) return res.status(400).json({ error: 'xpAmount required' });

    const db = admin.database();
    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);
    
    await userRef.transaction((currentData) => {
      if (currentData === null) {
        return { xp: xpAmount, level: getLevelFromXp(xpAmount), username: 'Unknown' };
      }
      currentData.xp += xpAmount;
      currentData.level = getLevelFromXp(currentData.xp);
      return currentData;
    }, async (error, committed, snapshot) => {
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      if (committed) {
        const newData = snapshot.val();
        await logAudit(db, {
          userId,
          action: 'boost_rank',
          oldLevel: getLevelFromXp(newData.xp - xpAmount),
          newLevel: newData.level,
          xpChange: xpAmount,
          adminId,
          adminName,
          reason: reason || 'Dashboard boost'
        });
        res.json({ success: true, newLevel: newData.level, totalXp: newData.xp });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST reset
router.post('/:guildId/:userId/reset', async (req, res) => {
  try {
    const { guildId, userId } = req.params;
    const { adminId, adminName } = req.body;

    const db = admin.database();
    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);

    const snapshot = await userRef.once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'User not found' });

    const userData = snapshot.val();
    const oldLevel = userData.level;
    const xpChange = -userData.xp;

    await userRef.update({ xp: 0, level: 0 });
    
    await logAudit(db, {
      userId,
      action: 'reset_stats',
      oldLevel,
      newLevel: 0,
      xpChange,
      adminId,
      adminName,
      reason: 'Dashboard reset'
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

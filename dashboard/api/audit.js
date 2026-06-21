const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// GET audit log
router.get('/', async (req, res) => {
  try {
    const db = admin.database();
    // Get last 50 audit logs, ordered by timestamp
    const snapshot = await db.ref('audit-log')
      .orderByChild('timestamp')
      .limitToLast(50)
      .once('value');

    if (!snapshot.exists()) {
      return res.json([]);
    }

    const logs = [];
    snapshot.forEach((child) => {
      logs.unshift({ id: child.key, ...child.val() }); // reverse order
    });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

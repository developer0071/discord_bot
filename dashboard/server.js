require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const app = express();
app.use(cors());
app.use(express.json());

// Static UI
app.use(express.static(path.join(__dirname, 'ui')));

// API Routes
app.use('/api/users', require('./api/users'));
app.use('/api/boost', require('./api/boost'));
app.use('/api/audit', require('./api/audit'));

// Fallback to UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
});

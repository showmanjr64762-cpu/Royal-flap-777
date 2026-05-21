const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Firebase initialization
let serviceAccount;

try {
  if (process.env.FB_PRIVATE_KEY && process.env.FB_CLIENT_EMAIL && process.env.FB_PROJECT_ID) {
    let privateKey = process.env.FB_PRIVATE_KEY;
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    serviceAccount = {
      type: "service_account",
      project_id: process.env.FB_PROJECT_ID,
      private_key: privateKey,
      client_email: process.env.FB_CLIENT_EMAIL,
      client_id: process.env.FB_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FB_CLIENT_EMAIL)}`,
      universe_domain: "googleapis.com"
    };
    console.log('✅ Firebase initialized');
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
} catch (error) {
  console.error('❌ Firebase error:', error.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('✅ Firestore ready');

// ============ API ROUTES ============

app.post('/api/scores', async (req, res) => {
  try {
    const { playerName, score, gameType, userId } = req.body;
    
    if (!playerName || score === undefined) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    const scoreData = {
      playerName: playerName.substring(0, 50),
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    const docRef = await db.collection('scores').add(scoreData);
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scores/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const snapshot = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    const scores = [];
    snapshot.forEach(doc => {
      scores.push({ id: doc.id, ...doc.data() });
    });
    res.json({ success: true, scores });
  } catch (error) {
    res.json({ success: true, scores: [] });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// ============ SERVE YOUR HTML GAME ============
// This is what you're missing - makes your game show at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'new lobby.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server on port ${PORT}`);
  console.log(`🎮 Game at: http://localhost:${PORT}`);
  console.log(`📡 API at: http://localhost:${PORT}/api/scores/top`);
});
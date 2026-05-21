const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

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
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FB_CLIENT_EMAIL}`,
      universe_domain: "googleapis.com"
    };
    console.log('✅ Firebase initialized');
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
} catch (error) {
  console.error('❌ Firebase config error:', error.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('✅ Firestore connected');

// ============ SIMPLIFIED API ROUTES (No complex queries) ============

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Flappy777 API is running',
    endpoints: ['GET /health', 'POST /api/scores', 'GET /api/scores/top']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Save score (simplified)
app.post('/api/scores', async (req, res) => {
  try {
    const { playerName, score, gameType, userId } = req.body;
    
    if (!playerName || score === undefined) {
      return res.status(400).json({ success: false, error: 'Missing playerName or score' });
    }
    
    const scoreData = {
      playerName: playerName.substring(0, 50),
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    // Simple save - no query
    const docRef = await db.collection('scores').add(scoreData);
    
    res.json({ 
      success: true, 
      id: docRef.id,
      message: 'Score saved successfully'
    });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get top scores (simplified - no where clause)
app.get('/api/scores/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    // Simple query - just order by score
    const snapshot = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    const scores = [];
    snapshot.forEach(doc => {
      scores.push({
        id: doc.id,
        playerName: doc.data().playerName,
        score: doc.data().score,
        gameType: doc.data().gameType,
        date: doc.data().date
      });
    });
    
    res.json({ success: true, scores });
  } catch (error) {
    console.error('Leaderboard error:', error);
    // If index error, return empty array instead of failing
    if (error.message && error.message.includes('index')) {
      res.json({ success: true, scores: [], message: 'Index building, try again in 2 minutes' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Get player scores (simplified)
app.get('/api/scores/player/:name', async (req, res) => {
  try {
    const playerName = decodeURIComponent(req.params.name);
    
    // Get all scores and filter in memory (simpler, no index needed)
    const snapshot = await db.collection('scores').get();
    
    let bestScore = null;
    let bestValue = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.playerName === playerName && data.score > bestValue) {
        bestValue = data.score;
        bestScore = { id: doc.id, ...data };
      }
    });
    
    res.json({ success: true, bestScore });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leaderboard with pagination (simplified)
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    
    const snapshot = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    const scores = [];
    let rank = 1;
    snapshot.forEach(doc => {
      scores.push({
        rank: rank++,
        id: doc.id,
        playerName: doc.data().playerName,
        score: doc.data().score,
        date: doc.data().date
      });
    });
    
    res.json({ success: true, data: scores });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.json({ success: true, data: [] });
  }
});

// Game result
app.post('/api/game/result', async (req, res) => {
  try {
    const { playerName, score, gameType, userId } = req.body;
    
    const result = {
      playerName: playerName?.substring(0, 50) || 'Anonymous',
      score: Number(score) || 0,
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    const docRef = await db.collection('gameResults').add(result);
    
    // Also save to scores
    await db.collection('scores').add(result);
    
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.url}` });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/health`);
  console.log(`🎮 API: http://localhost:${PORT}/api/scores/top\n`);
});
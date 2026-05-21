const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin with multiple environment variables
let serviceAccount;

try {
  // Check if we have individual environment variables (your existing setup)
  if (process.env.FB_PRIVATE_KEY && process.env.FB_CLIENT_EMAIL && process.env.FB_PROJECT_ID) {
    serviceAccount = {
      type: "service_account",
      project_id: process.env.FB_PROJECT_ID,
      private_key_id: process.env.FB_PRIVATE_KEY_ID || "auto",
      private_key: process.env.FB_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FB_CLIENT_EMAIL,
      client_id: process.env.FB_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FB_CLIENT_EMAIL}`,
      universe_domain: "googleapis.com"
    };
    console.log('✅ Firebase initialized from individual environment variables');
  }
  // Check if we have combined FIREBASE_CONFIG (new setup)
  else if (process.env.FIREBASE_CONFIG) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    console.log('✅ Firebase initialized from combined FIREBASE_CONFIG');
  }
  // Fallback to local file
  else {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Firebase initialized from local file');
  }
} catch (error) {
  console.error('ERROR: No Firebase configuration found!');
  console.error('Please set either:');
  console.error('  - FB_PRIVATE_KEY, FB_CLIENT_EMAIL, FB_PROJECT_ID (your current setup)');
  console.error('  - Or FIREBASE_CONFIG (single JSON string)');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('✅ Firestore ready');

// ============ API ROUTES ============

// Save game score
app.post('/api/scores', async (req, res) => {
  try {
    const { playerName, score, level, userId } = req.body;
    
    if (!playerName || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const scoreData = {
      playerName,
      score: Number(score),
      level: level || 1,
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    const docRef = await db.collection('scores').add(scoreData);
    res.status(201).json({ success: true, id: docRef.id, ...scoreData });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get top scores
app.get('/api/scores/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topScores = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(Math.min(limit, 50))
      .get();
    
    const scores = [];
    topScores.forEach(doc => {
      scores.push({ id: doc.id, ...doc.data() });
    });
    
    res.json({ success: true, scores });
  } catch (error) {
    console.error('Error getting top scores:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player's best score
app.get('/api/scores/player/:name', async (req, res) => {
  try {
    const playerName = decodeURIComponent(req.params.name);
    const playerScores = await db.collection('scores')
      .where('playerName', '==', playerName)
      .orderBy('score', 'desc')
      .limit(1)
      .get();
    
    let bestScore = null;
    playerScores.forEach(doc => {
      bestScore = { id: doc.id, ...doc.data() };
    });
    
    res.json(bestScore || { success: true, message: 'No scores found' });
  } catch (error) {
    console.error('Error getting player score:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user stats
app.get('/api/user/:userId/stats', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userScores = await db.collection('scores')
      .where('userId', '==', userId)
      .orderBy('score', 'desc')
      .limit(10)
      .get();
    
    const scores = [];
    userScores.forEach(doc => {
      scores.push({ id: doc.id, ...doc.data() });
    });
    
    const totalGames = scores.length;
    const bestScore = scores.length > 0 ? scores[0].score : 0;
    const averageScore = totalGames > 0 
      ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / totalGames) 
      : 0;
    
    res.json({
      success: true,
      stats: {
        totalGames,
        bestScore,
        averageScore,
        recentScores: scores.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const scoresQuery = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    const scores = [];
    scoresQuery.forEach(doc => {
      scores.push({ rank: scores.length + 1 + offset, id: doc.id, ...doc.data() });
    });
    
    res.json({
      success: true,
      data: scores,
      pagination: { page, limit }
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit game result
app.post('/api/game/result', async (req, res) => {
  try {
    const { playerName, score, gameType, userId, metadata } = req.body;
    
    const gameResult = {
      playerName,
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      metadata: metadata || {},
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    const docRef = await db.collection('gameResults').add(gameResult);
    
    // Also save to scores collection for leaderboard
    await db.collection('scores').add({
      playerName,
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    });
    
    // Check if this is a high score for this player
    let isHighScore = false;
    const playerBest = await db.collection('scores')
      .where('playerName', '==', playerName)
      .orderBy('score', 'desc')
      .limit(1)
      .get();
    
    let currentBest = 0;
    playerBest.forEach(doc => {
      currentBest = doc.data().score;
    });
    isHighScore = score > currentBest;
    
    res.status(201).json({ 
      success: true, 
      id: docRef.id, 
      isHighScore,
      message: isHighScore ? '🎉 New High Score!' : 'Score saved successfully'
    });
  } catch (error) {
    console.error('Error saving game result:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Flappy777 Game Backend',
    version: '1.0.0',
    status: 'running',
    endpoints: [
      'GET  /health',
      'GET  /',
      'POST /api/scores',
      'GET  /api/scores/top',
      'GET  /api/scores/player/:name',
      'GET  /api/user/:userId/stats',
      'GET  /api/leaderboard',
      'POST /api/game/result'
    ]
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎮 API ready: http://localhost:${PORT}/api`);
});
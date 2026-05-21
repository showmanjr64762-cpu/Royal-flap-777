const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

// ============ CORS CONFIGURATION ============
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.options('*', cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============ FIREBASE INITIALIZATION ============
let serviceAccount;

try {
  // Check for individual environment variables
  if (process.env.FB_PRIVATE_KEY && process.env.FB_CLIENT_EMAIL && process.env.FB_PROJECT_ID) {
    let privateKey = process.env.FB_PRIVATE_KEY;
    // Replace literal \n with actual newlines
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    serviceAccount = {
      type: "service_account",
      project_id: process.env.FB_PROJECT_ID,
      private_key_id: process.env.FB_PRIVATE_KEY_ID || "auto",
      private_key: privateKey,
      client_email: process.env.FB_CLIENT_EMAIL,
      client_id: process.env.FB_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FB_CLIENT_EMAIL)}`,
      universe_domain: "googleapis.com"
    };
    console.log('✅ Firebase initialized from environment variables');
  }
  // Check for combined config
  else if (process.env.FIREBASE_CONFIG) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    console.log('✅ Firebase initialized from FIREBASE_CONFIG');
  }
  // Fallback to local file (development only)
  else {
    try {
      serviceAccount = require('./serviceAccountKey.json');
      console.log('✅ Firebase initialized from local file');
    } catch (err) {
      console.error('❌ No Firebase configuration found!');
      process.exit(1);
    }
  }
} catch (error) {
  console.error('❌ Firebase config error:', error.message);
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('✅ Firestore connected');

// ============ API ROUTES ============

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Flappy777 Game Backend',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      saveScore: 'POST /api/scores',
      topScores: 'GET /api/scores/top',
      playerScore: 'GET /api/scores/player/:name',
      userStats: 'GET /api/user/:userId/stats',
      leaderboard: 'GET /api/leaderboard',
      gameResult: 'POST /api/game/result'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected'
  });
});

// Save game score
app.post('/api/scores', async (req, res) => {
  try {
    const { playerName, score, level, userId, gameType } = req.body;
    
    if (!playerName || score === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: playerName and score are required' 
      });
    }
    
    const scoreData = {
      playerName: playerName.substring(0, 50),
      score: Number(score),
      level: level || 1,
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    const docRef = await db.collection('scores').add(scoreData);
    
    // Check if this is a high score
    const playerBestQuery = await db.collection('scores')
      .where('playerName', '==', playerName)
      .orderBy('score', 'desc')
      .limit(1)
      .get();
    
    let isHighScore = false;
    let currentBest = 0;
    playerBestQuery.forEach(doc => {
      currentBest = doc.data().score;
    });
    isHighScore = score > currentBest;
    
    res.status(201).json({ 
      success: true, 
      id: docRef.id,
      isHighScore,
      message: isHighScore ? '🎉 New High Score!' : 'Score saved'
    });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get top scores
app.get('/api/scores/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    const scoresSnapshot = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    const scores = [];
    scoresSnapshot.forEach(doc => {
      scores.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({ success: true, scores });
  } catch (error) {
    console.error('Error getting top scores:', error);
    res.status(500).json({ success: false, error: error.message });
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
    
    res.json({ 
      success: true, 
      bestScore,
      message: bestScore ? 'Found best score' : 'No scores found for this player'
    });
  } catch (error) {
    console.error('Error getting player score:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user stats
app.get('/api/user/:userId/stats', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userScores = await db.collection('scores')
      .where('userId', '==', userId)
      .orderBy('score', 'desc')
      .limit(20)
      .get();
    
    const scores = [];
    userScores.forEach(doc => {
      scores.push(doc.data());
    });
    
    const totalGames = scores.length;
    const bestScore = totalGames > 0 ? Math.max(...scores.map(s => s.score)) : 0;
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const averageScore = totalGames > 0 ? Math.round(totalScore / totalGames) : 0;
    
    res.json({
      success: true,
      stats: {
        totalGames,
        bestScore,
        averageScore,
        totalScore,
        recentScores: scores.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get leaderboard with pagination
app.get('/api/leaderboard', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    
    const scoresSnapshot = await db.collection('scores')
      .orderBy('score', 'desc')
      .limit(limit)
      .offset(offset)
      .get();
    
    const scores = [];
    scoresSnapshot.forEach((doc, index) => {
      scores.push({
        rank: offset + index + 1,
        id: doc.id,
        playerName: doc.data().playerName,
        score: doc.data().score,
        date: doc.data().date
      });
    });
    
    // Get total count
    const totalSnapshot = await db.collection('scores').count().get();
    const total = totalSnapshot.data().count;
    
    res.json({
      success: true,
      data: scores,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit game result
app.post('/api/game/result', async (req, res) => {
  try {
    const { playerName, score, gameType, userId, metadata } = req.body;
    
    if (!playerName || score === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    const gameResult = {
      playerName: playerName.substring(0, 50),
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      metadata: metadata || {},
      date: new Date().toISOString(),
      timestamp: Date.now()
    };
    
    // Save to gameResults collection
    const resultRef = await db.collection('gameResults').add(gameResult);
    
    // Also save to scores collection for leaderboard
    const scoreRef = await db.collection('scores').add({
      playerName: playerName.substring(0, 50),
      score: Number(score),
      gameType: gameType || 'casino_shuffle',
      userId: userId || null,
      date: new Date().toISOString(),
      timestamp: Date.now()
    });
    
    // Check for high score
    const playerBest = await db.collection('scores')
      .where('playerName', '==', playerName)
      .orderBy('score', 'desc')
      .limit(1)
      .get();
    
    let isHighScore = false;
    let currentBest = 0;
    playerBest.forEach(doc => {
      currentBest = doc.data().score;
    });
    isHighScore = score >= currentBest;
    
    res.status(201).json({
      success: true,
      id: resultRef.id,
      scoreId: scoreRef.id,
      isHighScore,
      message: isHighScore ? '🎉 New High Score!' : 'Game result saved'
    });
  } catch (error) {
    console.error('Error saving game result:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.url}`,
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎮 API base: http://localhost:${PORT}/api`);
  console.log(`✅ CORS enabled for all origins\n`);
});
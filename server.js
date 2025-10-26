require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { WorkOS } = require('@workos-inc/node');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const workos = new WorkOS({ apiKey: process.env.WORKOS_API_KEY });
const port = process.env.PORT || 3000;

// Session middleware
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);

// Make session available in Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Serve static files
app.use(express.static('public'));

// ----------------- LOGIN ROUTE -----------------
app.get('/login', async (req, res) => {
  try {
    const authorizationUrl = await workos.sso.getAuthorizationURL({
      clientId: process.env.WORKOS_CLIENT_ID,
      redirectUri: 'https://dreidel.onrender.com/auth/callback',
      connection: process.env.conn_01K8GXX24YHR5Y0ZVABRZ5ZTYC,
    });
    res.redirect(authorizationUrl);
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).send('Login Error: ' + err.message);
  }
});

// ----------------- CALLBACK ROUTE -----------------
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const profile = await workos.sso.getProfileAndToken({
      code,
      clientId: process.env.WORKOS_CLIENT_ID,
    });

    req.session.user = {
      id: profile.profile.id,
      name: profile.profile.name || profile.profile.email,
      email: profile.profile.email,
    };

    res.redirect('/');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Callback Error: ' + err.message);
  }
});

// ----------------- LOGOUT ROUTE -----------------
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ----------------- SESSION INFO -----------------
app.get('/auth/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ----------------- MULTIPLAYER SOCKET.IO -----------------
let players = {};
let pot = 0;
let turnOrder = [];
let currentTurnIndex = 0;

function checkWinner() {
  const activePlayers = Object.values(players).filter(p => p.coins > 0);
  if (activePlayers.length === 1) return activePlayers[0];
  return null;
}

function resetGame() {
  pot = 0;
  turnOrder.forEach(id => {
    if (players[id]) {
      players[id].coins = 10;
      pot += 1;
    }
  });
  currentTurnIndex = 0;
  io.emit('gameState', { players, pot, currentTurn: turnOrder[currentTurnIndex] });
}

io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session.user) return socket.disconnect(true);

  const userId = session.user.id;

  if (!players[userId]) {
    players[userId] = {
      id: userId,
      name: session.user.name,
      coins: 10,
      socketId: socket.id,
    };
    turnOrder.push(userId);
    pot += 1;
  }

  io.emit('gameState', { players, pot, currentTurn: turnOrder[currentTurnIndex] });

  // Spin
  socket.on('spin', () => {
    if (turnOrder[currentTurnIndex] !== userId) return;

    const outcomes = ["Nun", "Gimel", "Hey", "Shin"];
    const result = outcomes[Math.floor(Math.random() * outcomes.length)];
    const player = players[userId];

    switch (result) {
      case "Gimel":
        player.coins += pot;
        pot = 0;
        break;
      case "Hey":
        const half = Math.ceil(pot / 2);
        player.coins += half;
        pot -= half;
        break;
      case "Shin":
        if (player.coins > 0) {
          player.coins -= 1;
          pot += 1;
        }
        break;
      case "Nun":
      default:
        break;
    }

    // Check for winner
    const winner = checkWinner();
    if (winner) {
      io.emit('gameOver', { winner: winner.name });
      // Auto reset after 5s
      setTimeout(() => {
        resetGame();
      }, 5000);
      return;
    }

    currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
    io.emit('gameState', { players, pot, currentTurn: turnOrder[currentTurnIndex], lastSpin: { player: player.name, result } });
  });

  // Manual restart
  socket.on('restart', () => {
    resetGame();
  });

  // Disconnect
  socket.on('disconnect', () => {
    delete players[userId];
    turnOrder = turnOrder.filter(id => id !== userId);
    if (currentTurnIndex >= turnOrder.length) currentTurnIndex = 0;
    io.emit('gameState', { players, pot, currentTurn: turnOrder[currentTurnIndex] });
  });
});

server.listen(port, () => {
  console.log(`Dreidel game running at http://localhost:${port}`);
});


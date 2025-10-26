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

// Session setup
const sessionMiddleware = session({
  secret: 'super-secret-session-key', // replace with strong secret in prod
  resave: false,
  saveUninitialized: true,
});

app.use(sessionMiddleware);

// Make session available in Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Serve static frontend
app.use(express.static('public'));

// ----------------- LOGIN ROUTE -----------------
app.get('/login', async (req, res) => {
  try {
    const authorizationUrl = await workos.sso.getAuthorizationURL({
      clientId: process.env.WORKOS_CLIENT_ID,
      redirectUri: 'https://your-render-app.onrender.com/auth/callback',
      connection: 'conn_XXXXXXXXXXXXXXXX', // your WorkOS connection ID
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

    res.redirect('/'); // redirect to game lobby
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Callback Error: ' + err.message);
  }
});

// ----------------- LOGOUT ROUTE -----------------
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ----------------- MULTIPLAYER SOCKET.IO -----------------
let players = {};

io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session.user) {
    return socket.disconnect(true); // only allow logged-in users
  }

  const userId = session.user.id;
  players[userId] = {
    id: userId,
    name: session.user.name,
    socketId: socket.id,
  };

  // Notify everyone of updated player list
  io.emit('playersUpdate', Object.values(players));

  // Handle Dreidel spins
  socket.on('spin', () => {
    const outcomes = ["Nun", "Gimel", "Hey", "Shin"];
    const result = outcomes[Math.floor(Math.random() * outcomes.length)];
    io.emit('spinResult', { player: session.user.name, result });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    delete players[userId];
    io.emit('playersUpdate', Object.values(players));
  });
});

// Start server
server.listen(port, () => {
  console.log(`Dreidel game running at http://localhost:${port}`);
});


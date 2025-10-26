require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { WorkOS } = require('@workos-inc/node'); // Fixed import

const app = express();
const workos = new WorkOS({ apiKey: process.env.WORKOS_API_KEY }); // Fixed constructor

app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: true,
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Users DB
const USERS_FILE = './users.json';
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Game sessions
const games = {};

// 1. WorkOS login
app.get('/auth/workos', (req, res) => {
  const url = workos.sso.getAuthorizationURL({
    clientID: process.env.WORKOS_CLIENT_ID,
    redirectURI: 'http://localhost:3000/auth/callback', // Change to hosted URL later
    state: 'optional_state',
  });
  res.redirect(url);
});

// 2. Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const profile = await workos.sso.getProfileAndToken({ code });

    const users = loadUsers();
    if (!users[profile.user.id]) {
      users[profile.user.id] = {
        id: profile.user.id,
        name: profile.user.name || 'Unknown',
        coins: 10,
        wins: 0,
      };
      saveUsers(users);
    }

    req.session.userId = profile.user.id;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.send('Authentication failed');
  }
});

// 3. Current user info
app.get('/api/me', (req, res) => {
  const users = loadUsers();
  const user = users[req.session.userId];
  if (user) res.json(user);
  else res.status(401).json({ error: 'Not logged in' });
});

// 4. Update stats
app.post('/api/user/update', (req, res) => {
  const { coins, wins } = req.body;
  const users = loadUsers();
  const user = users[req.session.userId];
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (typeof coins === 'number') user.coins = coins;
  if (typeof wins === 'number') user.wins = wins;
  saveUsers(users);
  res.json(user);
});

// 5. Start a game
app.post('/api/game/start', (req,res)=>{
  const { playerIds, bots } = req.body;
  if(!playerIds || playerIds.length === 0) return res.status(400).json({error:'No players'});
  const users = loadUsers();
  const sessionId = Math.random().toString(36).substring(2,10);
  const players = playerIds.map(id => ({ ...users[id], isBot:false }));

  for(let i=0;i<bots;i++){
    players.push({ id:'bot_'+i, name:'Bot'+(i+1), coins:10, wins:0, isBot:true });
  }

  games[sessionId] = { players, turnIndex:0 };
  res.json({ sessionId, players });
});

// 6. Join game
app.post('/api/game/join', (req,res)=>{
  const { sessionId } = req.body;
  const userId = req.session.userId;
  if(!userId) return res.status(401).json({error:'Not logged in'});
  const users = loadUsers();
  const game = games[sessionId];
  if(!game) return res.status(404).json({error:'Game not found'});
  if(!game.players.find(p => p.id === userId)){
    game.players.push({ ...users[userId], isBot:false });
  }
  res.json(game);
});

// 7. Get game state
app.get('/api/game/:sessionId', (req,res)=>{
  const game = games[req.params.sessionId];
  if(!game) return res.status(404).json({error:'Game not found'});
  res.json(game);
});

// 8. Spin dreidel
app.post('/api/game/:sessionId/spin', (req,res)=>{
  const game = games[req.params.sessionId];
  if(!game) return res.status(404).json({error:'Game not found'});
  const player = game.players[game.turnIndex];
  const outcomes = ['נ','ג','ה','ש'];
  const result = outcomes[Math.floor(Math.random()*4)];

  if(result === 'ג') { player.coins +=4; if(!player.isBot) player.wins+=1; }
  else if(result==='נ') player.coins +=1;
  else if(result==='ה') player.coins +=2;
  else player.coins = Math.max(0,player.coins-1);

  if(!player.isBot && player.id.startsWith('user')){
    const users = loadUsers();
    users[player.id].coins = player.coins;
    users[player.id].wins = player.wins;
    saveUsers(users);
  }

  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  res.json({ player: player.name, result, coins: player.coins, wins: player.wins, nextPlayer: game.players[game.turnIndex].name });
});

// Logout
app.get('/logout', (req,res)=>{
  req.session.destroy(()=> res.redirect('/'));
});

app.listen(3000, ()=>console.log('Server running on http://localhost:3000'));

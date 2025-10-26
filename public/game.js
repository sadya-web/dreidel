const socket = io();

const loginDiv = document.getElementById('loginDiv');
const gameDiv = document.getElementById('gameDiv');
const greeting = document.getElementById('greeting');
const playerList = document.getElementById('playerList');
const resultDiv = document.getElementById('result');
const spinBtn = document.getElementById('spinBtn');
const restartBtn = document.getElementById('restartBtn');

// Fetch session info
fetch('/auth/session')
  .then(res => res.json())
  .then(data => {
    if (data.user) {
      loginDiv.style.display = 'none';
      gameDiv.style.display = 'block';
      greeting.textContent = `Hello, ${data.user.name}`;
    }
  });

// Update game state
socket.on('gameState', data => {
  playerList.innerHTML = '';
  Object.values(data.players).forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} – ${p.coins} coins`;
    if (p.id === data.currentTurn) li.textContent += ' ← Turn';
    playerList.appendChild(li);
  });

  resultDiv.textContent = `Pot: ${data.pot} coins`;
  if (data.lastSpin) {
    resultDiv.textContent += ` | ${data.lastSpin.player} spun ${data.lastSpin.result}`;
  }

  fetch('/auth/session')
    .then(res => res.json())
    .then(sessionData => {
      spinBtn.disabled = !sessionData.user || sessionData.user.id !== data.currentTurn;
    });
});

// Game over
socket.on('gameOver', data => {
  resultDiv.textContent = `${data.winner} wins the game! Restarting in 5 seconds...`;
});

// Spin button
spinBtn.addEventListener('click', () => {
  socket.emit('spin');
});

// Manual restart button
restartBtn.addEventListener('click', () => {
  socket.emit('restart');
});

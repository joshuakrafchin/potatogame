const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { GameManager } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const gameManager = new GameManager();

// Serve static landing page
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Catch potato landing page (viral entry point)
app.get('/catch/:tossId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catch.html'));
});

// API: Check pending toss status
app.get('/api/toss/:tossId', (req, res) => {
  const pending = gameManager.pendingTosses.get(req.params.tossId);
  if (!pending) return res.json({ error: 'Not found or expired' });
  if (pending.claimed) return res.json({ error: 'Already claimed' });
  const now = Date.now();
  if (now > pending.expiresAt) return res.json({ error: 'Burned! Too late.' });
  res.json({
    fromName: pending.fromPlayerName,
    potatoType: pending.potatoType,
    secondsLeft: Math.floor((pending.expiresAt - now) / 1000),
    expiresAt: pending.expiresAt
  });
});

// --- Socket.IO: Global game (no rooms) ---
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Register player
  socket.on('register', ({ playerName }) => {
    const player = gameManager.registerPlayer(socket.id, playerName);
    socket.emit('registered', { player: gameManager.getPlayerPublic(player) });
    // Deliver any pending potatoes (tossed while offline)
    if (gameManager.db) {
      const pending = gameManager.db.getPendingPotatoes(player.dbId || player.id);
      if (pending.length > 0) {
        const potato = pending[0]; // deliver first one
        potato.holderId = socket.id;
        // Reset timers for fresh delivery
        const { POTATO_TYPES } = require('./game');
        const typeDef = POTATO_TYPES[potato.type];
        const now = Date.now();
        potato.hotTime = now + typeDef.hotSeconds * 1000 * potato.heatModifier;
        potato.burnTime = now + typeDef.burnSeconds * 1000 * potato.heatModifier;
        potato.isHot = false;
        player.potato = potato;
        player.stats.totalReceived++;
        const badges = gameManager._checkBadges(player);
        socket.emit('potato_received', {
          player: gameManager.getPlayerPublic(player),
          potato,
          fromPlayer: 'a friend',
          badges
        });
        gameManager.persistPlayer(player);
      }
    }
    broadcastPlayerList();
  });

  // Request a test potato (for demo/testing)
  socket.on('request_test_potato', () => {
    const player = gameManager.getPlayer(socket.id);
    if (!player) return;
    if (player.potato) { socket.emit('error', { message: 'You already have a potato!' }); return; }
    const { createPotato } = require('./game');
    const potato = createPotato('GOLDEN');
    potato.holderId = socket.id;
    player.potato = potato;
    player.stats.totalReceived++;
    const badges = gameManager._checkBadges(player);
    socket.emit('potato_received', {
      player: gameManager.getPlayerPublic(player),
      potato,
      fromPlayer: 'The Farm',
      badges
    });
    broadcastPlayerList();
  });

  // Toss to any player (online or offline)
  socket.on('toss_potato', ({ targetPlayerId }) => {
    const result = gameManager.tossPotato(socket.id, targetPlayerId);
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    socket.emit('toss_success', {
      player: result.tosser,
      coinsEarned: result.coinsEarned,
      tossType: result.tossType,
      badges: result.tosserBadges
    });
    // Only send to receiver if they're online
    if (!result.receiverOffline) {
      io.to(targetPlayerId).emit('potato_received', {
        player: result.receiver,
        potato: result.potato,
        fromPlayer: result.tosser.name,
        badges: result.receiverBadges
      });
    }
    broadcastPlayerList();
  });

  // Create external toss (share link)
  socket.on('create_share_toss', ({ potatoType }) => {
    const result = gameManager.createExternalToss(socket.id, potatoType);
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    socket.emit('share_toss_created', result);
  });

  // Claim external toss
  socket.on('claim_toss', ({ tossId }) => {
    const result = gameManager.claimExternalToss(tossId, socket.id);
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    socket.emit('potato_received', {
      player: result.receiver,
      potato: result.potato,
      fromPlayer: result.fromName,
      badges: result.badges
    });
    // Notify tosser if online
    const tosser = gameManager.getPlayer(result.potato.holderId);
    if (tosser) {
      io.to(result.receiver.id).emit('toss_claimed', {
        claimedBy: result.receiver.name
      });
    }
  });

  // Bump detection
  socket.on('bump_detected', ({ timestamp, latitude, longitude }) => {
    const match = gameManager.registerBump(socket.id, timestamp, latitude, longitude);
    if (match) {
      const p1 = gameManager.getPlayer(match.player1);
      const p2 = gameManager.getPlayer(match.player2);
      io.to(match.player1).emit('bump_matched', {
        partner: p2 ? gameManager.getPlayerPublic(p2) : null
      });
      io.to(match.player2).emit('bump_matched', {
        partner: p1 ? gameManager.getPlayerPublic(p1) : null
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    gameManager.removePlayer(socket.id);
    broadcastPlayerList();
  });
});

function broadcastPlayerList() {
  // Combine online players + all DB players
  const onlineIds = new Set();
  const players = [];
  gameManager.players.forEach((p) => {
    const pub = gameManager.getPlayerPublic(p);
    pub.online = true;
    players.push(pub);
    onlineIds.add(p.dbId || p.id);
  });
  // Add offline players from DB
  if (gameManager.db) {
    const allDb = gameManager.db.getAllPlayers();
    allDb.forEach((p) => {
      if (!onlineIds.has(p.id)) {
        players.push({
          id: p.id,
          name: p.name,
          coins: p.coins,
          hasPotato: false,
          badges: p.badges,
          stats: p.stats,
          online: false
        });
      }
    });
  }
  io.emit('player_list', { players });
}

// Game tick — burn timers
setInterval(() => {
  gameManager.tick(io);
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🥔 Hot Potato Server running on port ${PORT}`);
});

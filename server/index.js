const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { GameManager } = require('./game');
const push = require('./push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json({ limit: '16kb' }));

// Serve static landing page
app.use(express.static(path.join(__dirname, 'public')));

const gameManager = new GameManager();
push.init();

// Helper: fire a push notification when a player receives a potato.
// Best-effort; never throws into the request path.
function notifyIncomingPotato(receiverDbId, fromName, potatoName) {
  if (!receiverDbId || !gameManager.db) return;
  const payload = {
    type: 'potato_incoming',
    title: '🥔🔥 INCOMING POTATO!',
    body: (fromName || 'A friend') + ' tossed ye a ' + (potatoName || 'hot potato') + '!',
    url: '/',
    tag: 'potato-incoming',
  };
  push.sendToPlayer(gameManager.db, receiverDbId, payload).catch((e) => {
    console.warn('push send error:', e.message);
  });
}

app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.6.6' }));

// --- Web Push: VAPID public key + subscribe / unsubscribe ---
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
  const { playerId, subscription } = req.body || {};
  if (!playerId || !subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'playerId and subscription required' });
  }
  if (!gameManager.db) return res.status(503).json({ error: 'db unavailable' });
  gameManager.db.upsertPushSubscription(playerId, subscription);
  console.log('[push] subscribed:', playerId, subscription.endpoint.slice(0, 60) + '...');
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  if (!gameManager.db) return res.status(503).json({ error: 'db unavailable' });
  gameManager.db.removePushSubscription(endpoint);
  res.json({ ok: true });
});

// Test endpoint: send a push to yourself, so you can verify the pipeline
// without needing a second player to toss at you.
app.post('/api/push/test', async (req, res) => {
  const { playerId } = req.body || {};
  if (!playerId) return res.status(400).json({ error: 'playerId required' });
  if (!gameManager.db) return res.status(503).json({ error: 'db unavailable' });
  const result = await push.sendToPlayer(gameManager.db, playerId, {
    type: 'test',
    title: '🥔 Test ping!',
    body: 'If ye see this, push notifications are workin grand.',
    url: '/',
    tag: 'potato-test',
  });
  res.json(result);
});

// Admin: reset all player data
app.post('/admin/reset', (req, res) => {
  if (gameManager.db) {
    gameManager.db.db.exec('DELETE FROM players; DELETE FROM pending_potatoes;');
  }
  gameManager.players.clear();
  io.emit('force_reload', {});
  res.json({ status: 'cleared' });
});

// Catch potato landing page (viral entry point) — injects dynamic OG tags
const catchHtmlTemplate = fs.readFileSync(path.join(__dirname, 'public', 'catch.html'), 'utf8');
app.get('/catch/:tossId', (req, res) => {
  const pending = gameManager.pendingTosses.get(req.params.tossId);
  const fromName = (pending && pending.fromPlayerName) || 'A friend';
  const safeName = String(fromName).replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]);
  const title = safeName + ' tossed ye a HOT POTATO! 🥔🔥';
  const desc = 'Toss it to someone else before it burns ye! An Irish farm adventure.';
  let html = catchHtmlTemplate
    .replace(/__OG_TITLE__/g, title)
    .replace(/__OG_DESC__/g, desc)
    .replace(/__FROM_NAME__/g, safeName);
  res.send(html);
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

  // Unearth a potato from the farm (limited to N-1 total potatoes)
  socket.on('unearth_potato', ({ potatoType } = {}) => {
    const player = gameManager.getPlayer(socket.id);
    if (!player) return;
    if (player.potato) { socket.emit('error', { message: 'Ye already have a potato!' }); return; }

    // Count total active potatoes (online players holding one)
    let totalPotatoes = 0;
    let totalPlayers = gameManager.players.size;
    gameManager.players.forEach(p => { if (p.potato) totalPotatoes++; });

    // Max potatoes = total players - 1 (someone must have free hands!)
    const maxPotatoes = Math.max(totalPlayers - 1, 1);
    if (totalPotatoes >= maxPotatoes) {
      socket.emit('error', { message: 'Too many potatoes out! Wait for someone to get burned.' });
      return;
    }

    // Validate and charge for potato type
    const { createPotato, POTATO_TYPES } = require('./game');
    const type = (potatoType && POTATO_TYPES[potatoType]) ? potatoType : 'GOLDEN';
    const price = POTATO_TYPES[type].basePrice;
    if (type !== 'GOLDEN' && player.coins < price) {
      socket.emit('error', { message: 'Not enough coins! Need ' + price + ' PC.' });
      return;
    }
    if (type !== 'GOLDEN') player.coins -= price;

    const potato = createPotato(type);
    potato.holderId = socket.id;
    player.potato = potato;
    player.stats.totalReceived++;
    const badges = gameManager._checkBadges(player);
    gameManager.persistPlayer(player);
    socket.emit('potato_received', {
      player: gameManager.getPlayerPublic(player),
      potato,
      fromPlayer: 'The Farm',
      badges
    });
    // Broadcast activity
    broadcastEvent(player.name + ' unearthed a ' + POTATO_TYPES[type].name + '! ⛏️');
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
    if (!result.receiverOffline) {
      io.to(targetPlayerId).emit('potato_received', {
        player: result.receiver,
        potato: result.potato,
        fromPlayer: result.tosser.name,
        badges: result.receiverBadges
      });
    }
    // Push notification to the receiver (works whether they're online-but-backgrounded
    // or fully offline). Resolve their persistent db id from the target id.
    let receiverDbId = null;
    const onlineReceiver = gameManager.players.get(targetPlayerId);
    if (onlineReceiver) {
      receiverDbId = onlineReceiver.dbId || onlineReceiver.id;
    } else {
      // For offline players, the target id IS the db id (see broadcastPlayerList)
      receiverDbId = targetPlayerId;
    }
    console.log('[push] toss → receiverDbId=', receiverDbId, 'from=', result.tosser.name);
    notifyIncomingPotato(receiverDbId, result.tosser.name, result.potato && result.potato.name);
    const tossEmoji = result.tossType === 'danger' ? '🔥' : result.tossType === 'hot' ? '♨️' : '🥔';
    broadcastEvent(result.tosser.name + ' tossed a potato to ' + result.receiver.name + '! ' + tossEmoji);
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

function broadcastEvent(text) {
  io.emit('game_event', { text, time: Date.now() });
}

// Game tick — burn timers
setInterval(() => {
  gameManager.tick(io);
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🥔 Hot Potato Server running on port ${PORT}`);
});

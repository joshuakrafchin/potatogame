const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
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

app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.3.0' }));

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

// --- NPC Farmers ---
const NPC_FARMERS = [
  { id: 'npc_seamus', name: "Ol' Seamus", vibe: 'Slow but steady. Smells like turf smoke.' },
  { id: 'npc_mary', name: 'Mad Mary', vibe: 'Tosses fast. Laughs when ye burn.' },
  { id: 'npc_padraig', name: 'Paddy the Panicker', vibe: 'Screams the whole time. Sweats buckets.' },
  { id: 'npc_siobhan', name: 'Sneaky Siobhan', vibe: 'Holds it just long enough to scare ye.' },
  { id: 'npc_murphy', name: "Murphy's Ghost", vibe: 'The phantom farmer. Ye never see him comin.' },
];

const NPC_TOSS_QUOTES = [
  "Take it back, ye gobshite!",
  "Not today, lad!",
  "Here, hold me spud!",
  "AHHH! Too hot! TOO HOT!",
  "Catch this, ye eejit!",
  "Mother of Jaysus, get it away!",
  "Feck! Feck! FECK!",
  "That's your problem now!",
  "Sláinte! *YEET*",
  "Me fingers! ME POOR FINGERS!",
];

function getNpcTossDelay(npcId) {
  // Each NPC has different hold times
  switch (npcId) {
    case 'npc_seamus': return 6000 + Math.random() * 8000;   // slow: 6-14s
    case 'npc_mary': return 1500 + Math.random() * 3000;     // fast: 1.5-4.5s
    case 'npc_padraig': return 2000 + Math.random() * 4000;  // panicky: 2-6s
    case 'npc_siobhan': return 8000 + Math.random() * 10000; // sneaky: 8-18s (holds to scare)
    case 'npc_murphy': return 3000 + Math.random() * 5000;   // ghost: 3-8s
    default: return 3000 + Math.random() * 5000;
  }
}

function handleNpcToss(socket, playerId, npcId, potato) {
  const npc = NPC_FARMERS.find(n => n.id === npcId);
  if (!npc) return;

  const delay = getNpcTossDelay(npcId);
  const quote = NPC_TOSS_QUOTES[Math.floor(Math.random() * NPC_TOSS_QUOTES.length)];

  // NPC "holds" the potato then tosses back
  setTimeout(() => {
    const player = gameManager.getPlayer(playerId);
    if (!player) return; // player disconnected
    if (player.potato) return; // already holding something

    // Reset timers for the return toss
    const { createPotato, POTATO_TYPES } = require('./game');
    const typeDef = POTATO_TYPES[potato.type];
    const now = Date.now();
    potato.hotTime = now + typeDef.hotSeconds * 1000 * potato.heatModifier;
    potato.burnTime = now + typeDef.burnSeconds * 1000 * potato.heatModifier;
    potato.isHot = false;
    potato.holderId = playerId;
    potato.tosses++;

    player.potato = potato;
    player.stats.totalReceived++;
    const badges = gameManager._checkBadges(player);
    gameManager.persistPlayer(player);

    socket.emit('potato_received', {
      player: gameManager.getPlayerPublic(player),
      potato,
      fromPlayer: npc.name,
      badges
    });
    broadcastEvent(npc.name + ': "' + quote + '" 🥔💨');
    broadcastPlayerList();
  }, delay);

  // NPC activity while holding
  setTimeout(() => {
    const holdQuotes = [
      npc.name + ' is sweating...',
      npc.name + ' is panicking!',
      npc.name + " can't handle the heat!",
      npc.name + ' is looking for someone to toss to...',
    ];
    broadcastEvent(holdQuotes[Math.floor(Math.random() * holdQuotes.length)] + ' 😰');
  }, delay * 0.5);
}

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

  // Toss to any player (online, offline, or NPC)
  socket.on('toss_potato', ({ targetPlayerId }) => {
    // Check if tossing to NPC
    const npc = NPC_FARMERS.find(n => n.id === targetPlayerId);
    if (npc) {
      const player = gameManager.getPlayer(socket.id);
      if (!player || !player.potato) {
        socket.emit('error', { message: 'You have no potato to toss!' });
        return;
      }
      const potato = player.potato;
      const now = Date.now();

      // Calculate coins like normal
      let tossType = 'normal';
      let coinsEarned = 2;
      const secondsUntilBurn = (potato.burnTime - now) / 1000;
      if (secondsUntilBurn <= 3) { tossType = 'danger'; coinsEarned = 10; }
      else if (potato.isHot) { tossType = 'hot'; coinsEarned = 5; }

      player.stats.currentStreak++;
      if (player.stats.currentStreak > player.stats.bestStreak) player.stats.bestStreak = player.stats.currentStreak;
      const { ECONOMY } = require('./game');
      const streakMult = player.stats.currentStreak >= 10 ? 3 : player.stats.currentStreak >= 5 ? 2 : player.stats.currentStreak >= 3 ? 1.5 : 1;
      coinsEarned = Math.floor(coinsEarned * streakMult);

      player.coins += coinsEarned;
      player.stats.totalTosses++;
      if (tossType === 'hot') player.stats.hotTosses++;
      if (tossType === 'danger') player.stats.dangerTosses++;
      const tosserBadges = gameManager._checkBadges(player);

      player.potato = null;
      gameManager.persistPlayer(player);

      socket.emit('toss_success', {
        player: gameManager.getPlayerPublic(player),
        coinsEarned,
        tossType,
        badges: tosserBadges
      });

      const tossEmoji = tossType === 'danger' ? '🔥' : tossType === 'hot' ? '♨️' : '🥔';
      broadcastEvent(player.name + ' tossed a potato to ' + npc.name + '! ' + tossEmoji);
      broadcastPlayerList();

      // NPC will toss it back after a delay
      handleNpcToss(socket, socket.id, targetPlayerId, potato);
      return;
    }

    // Normal player toss
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
  // Add NPC farmers (always available, shown when few real players)
  const realPlayerCount = players.length;
  const npcsToShow = realPlayerCount < 3 ? NPC_FARMERS : NPC_FARMERS.slice(0, 2); // show all if lonely, 2 if crowded
  npcsToShow.forEach(npc => {
    players.push({
      id: npc.id,
      name: npc.name,
      coins: '???',
      hasPotato: false,
      badges: [],
      stats: {},
      online: true,
      isNpc: true,
      vibe: npc.vibe
    });
  });

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

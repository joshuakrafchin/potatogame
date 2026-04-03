const { v4: uuidv4 } = require('uuid');

// --- Potato Types ---
const POTATO_TYPES = {
  GOLDEN: {
    name: 'Golden Potato',
    basePrice: 3,
    hotSeconds: 10,
    burnSeconds: 20,
    heatAcceleration: 0.9,
    description: 'Classic hot potato. Gets hotter each toss!'
  },
  HOME_FRY: {
    name: 'Home Fry',
    basePrice: 8,
    hotSeconds: 15,
    burnSeconds: 25,
    heatAcceleration: 0.95,
    description: 'Chunky and slow, but burns hard.'
  },
  BTC: {
    name: 'BTC Potato',
    basePrice: 5,
    hotSeconds: 8,
    burnSeconds: 15,
    heatAcceleration: 0.85,
    description: 'Volatile! Fast and unpredictable.'
  }
};

// --- Badge Definitions ---
const BADGE_DEFS = {
  FIRST_TOSS: {
    id: 'FIRST_TOSS',
    name: 'First Toss',
    description: 'Toss your first potato!',
    icon: '🥔✈️',
    coinBonus: 5
  },
  FIRST_CATCH: {
    id: 'FIRST_CATCH',
    name: 'First Catch',
    description: 'Receive your first potato!',
    icon: '🤲',
    coinBonus: 5
  },
  BURNED: {
    id: 'BURNED',
    name: 'Burned!',
    description: 'Get burned for the first time. Ouch!',
    icon: '🔥',
    coinBonus: 3
  },
  HOT_HANDS: {
    id: 'HOT_HANDS',
    name: 'Hot Hands',
    description: '5 hot tosses (tossed while potato was hot)',
    icon: '🖐️🔥',
    coinBonus: 10
  },
  STREAK_3: {
    id: 'STREAK_3',
    name: 'On a Roll',
    description: '3 tosses in a row without getting burned',
    icon: '⚡',
    coinBonus: 8
  },
  STREAK_10: {
    id: 'STREAK_10',
    name: 'Streak Master',
    description: '10 tosses without getting burned',
    icon: '🌟',
    coinBonus: 20
  }
};

// --- Coin Economy ---
const ECONOMY = {
  TOSS_BASE: 2,
  TOSS_HOT: 5,
  TOSS_DANGER: 10,
  RECEIVE_SURVIVE: 1,
  BURN_PENALTY: -3,
  STREAK_MULT_3: 1.5,
  STREAK_MULT_5: 2.0,
  STREAK_MULT_10: 3.0
};

function createPotato(type) {
  const def = POTATO_TYPES[type];
  const now = Date.now();
  return {
    id: uuidv4(),
    type,
    name: def.name,
    basePrice: def.basePrice,
    currentValue: def.basePrice,
    tosses: 0,
    heatModifier: 1.0,
    createdAt: now,
    hotTime: now + def.hotSeconds * 1000,
    burnTime: now + def.burnSeconds * 1000,
    isHot: false,
    holderId: null
  };
}

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name,
    coins: 10,
    potato: null,
    badges: [],
    stats: {
      totalTosses: 0,
      hotTosses: 0,
      dangerTosses: 0,
      totalReceived: 0,
      totalBurns: 0,
      currentStreak: 0,
      bestStreak: 0
    },
    // Social graph — tracks who you've played with
    connections: {} // { playerId: { name, tossesTo, tossesFrom, lastPlayed } }
  };
}

// --- Pending external tosses (for share link / text / email) ---
function createPendingToss(fromPlayer, potatoType) {
  const def = POTATO_TYPES[potatoType];
  return {
    id: uuidv4(),
    fromPlayerId: fromPlayer.id,
    fromPlayerName: fromPlayer.name,
    potatoType,
    createdAt: Date.now(),
    // External tosses get 5 minutes (more generous for install time)
    expiresAt: Date.now() + 5 * 60 * 1000,
    claimed: false
  };
}

class GameManager {
  constructor() {
    // Global player registry (no rooms)
    this.players = new Map();       // socketId -> player
    this.pendingTosses = new Map(); // tossId -> pendingToss
    this.bumps = [];                // global bump buffer
  }

  // --- Player Management ---
  registerPlayer(socketId, playerName) {
    const player = createPlayer(socketId, playerName);
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getPlayerPublic(player) {
    return {
      id: player.id,
      name: player.name,
      coins: player.coins,
      hasPotato: !!player.potato,
      badges: player.badges,
      stats: player.stats,
      connections: player.connections
    };
  }

  // --- Toss (in-app, between connected players) ---
  tossPotato(fromId, toId) {
    const tosser = this.players.get(fromId);
    const receiver = this.players.get(toId);
    if (!tosser) return { error: 'You are not connected' };
    if (!receiver) return { error: 'That player is offline' };
    if (!tosser.potato) return { error: 'You have no potato to toss!' };
    if (receiver.potato) return { error: 'They already have a potato!' };

    const potato = tosser.potato;
    const now = Date.now();

    // Determine toss type and coins
    let tossType = 'normal';
    let coinsEarned = ECONOMY.TOSS_BASE;
    const secondsUntilBurn = (potato.burnTime - now) / 1000;

    if (secondsUntilBurn <= 3) {
      tossType = 'danger';
      coinsEarned = ECONOMY.TOSS_DANGER;
      tosser.stats.dangerTosses++;
    } else if (potato.isHot) {
      tossType = 'hot';
      coinsEarned = ECONOMY.TOSS_HOT;
      tosser.stats.hotTosses++;
    }

    // Streak
    tosser.stats.currentStreak++;
    if (tosser.stats.currentStreak > tosser.stats.bestStreak) {
      tosser.stats.bestStreak = tosser.stats.currentStreak;
    }
    const streakMult = this._getStreakMultiplier(tosser.stats.currentStreak);
    coinsEarned = Math.floor(coinsEarned * streakMult);

    tosser.coins += coinsEarned;
    tosser.stats.totalTosses++;

    // Reset potato timers
    const typeDef = POTATO_TYPES[potato.type];
    potato.tosses++;
    potato.heatModifier *= typeDef.heatAcceleration;
    const hotMs = typeDef.hotSeconds * 1000 * potato.heatModifier;
    const burnMs = typeDef.burnSeconds * 1000 * potato.heatModifier;
    potato.hotTime = now + hotMs;
    potato.burnTime = now + burnMs;
    potato.isHot = false;
    potato.holderId = toId;

    // Transfer
    tosser.potato = null;
    receiver.potato = potato;
    receiver.stats.totalReceived++;

    // Update social graph
    this._updateConnection(tosser, receiver);
    this._updateConnection(receiver, tosser);

    // Check badges
    const tosserBadges = this._checkBadges(tosser);
    const receiverBadges = this._checkBadges(receiver);

    return {
      tosser: this.getPlayerPublic(tosser),
      receiver: this.getPlayerPublic(receiver),
      potato,
      coinsEarned,
      tossType,
      tosserBadges,
      receiverBadges
    };
  }

  // --- External Toss (share link, text, email, social) ---
  createExternalToss(fromId, potatoType) {
    const tosser = this.players.get(fromId);
    if (!tosser) return { error: 'Not connected' };

    // Create a potato for the toss
    const pending = createPendingToss(tosser, potatoType || 'GOLDEN');
    this.pendingTosses.set(pending.id, pending);

    return {
      tossId: pending.id,
      shareUrl: `/catch/${pending.id}`,
      expiresAt: pending.expiresAt
    };
  }

  claimExternalToss(tossId, claimerId) {
    const pending = this.pendingTosses.get(tossId);
    if (!pending) return { error: 'Toss not found or expired' };
    if (pending.claimed) return { error: 'Already claimed!' };
    if (Date.now() > pending.expiresAt) {
      this.pendingTosses.delete(tossId);
      return { error: 'Potato burned! Too late.' };
    }

    pending.claimed = true;

    const receiver = this.players.get(claimerId);
    if (!receiver) return { error: 'You are not connected' };
    if (receiver.potato) return { error: 'You already have a potato!' };

    // Create the potato for the receiver
    const potato = createPotato(pending.potatoType);
    potato.holderId = claimerId;
    receiver.potato = potato;
    receiver.stats.totalReceived++;

    // Update tosser stats if still online
    const tosser = this.players.get(pending.fromPlayerId);
    if (tosser) {
      tosser.stats.totalTosses++;
      tosser.coins += ECONOMY.TOSS_BASE;
      this._updateConnection(tosser, receiver);
      this._updateConnection(receiver, tosser);
    }

    const receiverBadges = this._checkBadges(receiver);

    this.pendingTosses.delete(tossId);

    return {
      potato,
      receiver: this.getPlayerPublic(receiver),
      fromName: pending.fromPlayerName,
      badges: receiverBadges
    };
  }

  // --- Bump Detection (accelerometer + GPS matching) ---
  registerBump(socketId, timestamp, lat, lng) {
    const now = Date.now();
    const bump = { playerId: socketId, timestamp, lat, lng, at: now };

    // Match against existing bumps
    const match = this.bumps.find((b) => {
      if (b.playerId === socketId) return false;
      const timeDiff = Math.abs(b.at - now);
      if (timeDiff > 2000) return false;
      const dist = this._haversineDistance(b.lat, b.lng, lat, lng);
      return dist < 50;
    });

    if (match) {
      this.bumps = this.bumps.filter((b) => b !== match);
      return { player1: match.playerId, player2: socketId };
    }

    // Store and clean old
    this.bumps = this.bumps.filter((b) => now - b.at < 5000);
    this.bumps.push(bump);
    return null;
  }

  // --- Tick (burn check) ---
  tick(io) {
    const now = Date.now();
    this.players.forEach((player) => {
      if (!player.potato) return;

      // Hot check
      if (!player.potato.isHot && now >= player.potato.hotTime) {
        player.potato.isHot = true;
        io.to(player.id).emit('potato_hot', {
          potato: player.potato,
          player: this.getPlayerPublic(player)
        });
      }

      // Burn check
      if (now >= player.potato.burnTime) {
        player.coins += ECONOMY.BURN_PENALTY;
        if (player.coins < 0) player.coins = 0;
        player.stats.totalBurns++;
        player.stats.currentStreak = 0;

        const burnedPotato = player.potato;
        player.potato = null;

        const badges = this._checkBadges(player);

        io.to(player.id).emit('potato_burned', {
          potato: burnedPotato,
          player: this.getPlayerPublic(player),
          coinsLost: Math.abs(ECONOMY.BURN_PENALTY),
          badges
        });
      }
    });

    // Clean expired pending tosses
    this.pendingTosses.forEach((p, id) => {
      if (now > p.expiresAt) this.pendingTosses.delete(id);
    });
  }

  // --- Helpers ---

  _getStreakMultiplier(streak) {
    if (streak >= 10) return ECONOMY.STREAK_MULT_10;
    if (streak >= 5) return ECONOMY.STREAK_MULT_5;
    if (streak >= 3) return ECONOMY.STREAK_MULT_3;
    return 1.0;
  }

  _checkBadges(player) {
    const newBadges = [];
    const tryAward = (badgeId, condition) => {
      if (!player.badges.includes(badgeId) && condition) {
        player.badges.push(badgeId);
        const def = BADGE_DEFS[badgeId];
        player.coins += def.coinBonus;
        newBadges.push(def);
      }
    };
    tryAward('FIRST_TOSS', player.stats.totalTosses >= 1);
    tryAward('FIRST_CATCH', player.stats.totalReceived >= 1);
    tryAward('BURNED', player.stats.totalBurns >= 1);
    tryAward('HOT_HANDS', player.stats.hotTosses >= 5);
    tryAward('STREAK_3', player.stats.bestStreak >= 3);
    tryAward('STREAK_10', player.stats.bestStreak >= 10);
    return newBadges;
  }

  _updateConnection(player, other) {
    if (!player.connections[other.id]) {
      player.connections[other.id] = {
        name: other.name,
        tossesTo: 0,
        tossesFrom: 0,
        lastPlayed: Date.now()
      };
    }
    const conn = player.connections[other.id];
    conn.tossesTo++;
    conn.lastPlayed = Date.now();
    conn.name = other.name;
  }

  _haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

module.exports = { GameManager, POTATO_TYPES, BADGE_DEFS, ECONOMY, createPotato };

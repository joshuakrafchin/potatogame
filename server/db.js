const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'potato.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    coins INTEGER DEFAULT 10,
    badges TEXT DEFAULT '[]',
    total_tosses INTEGER DEFAULT 0,
    hot_tosses INTEGER DEFAULT 0,
    danger_tosses INTEGER DEFAULT 0,
    total_received INTEGER DEFAULT 0,
    total_burns INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    last_seen INTEGER DEFAULT (unixepoch() * 1000)
  );
`);

// --- Prepared statements ---
const stmts = {
  getByName: db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE'),
  getById: db.prepare('SELECT * FROM players WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO players (id, name, coins, badges, total_tosses, hot_tosses, danger_tosses,
      total_received, total_burns, current_streak, best_streak)
    VALUES (?, ?, 10, '[]', 0, 0, 0, 0, 0, 0, 0)
  `),
  updateStats: db.prepare(`
    UPDATE players SET
      coins = ?, badges = ?,
      total_tosses = ?, hot_tosses = ?, danger_tosses = ?,
      total_received = ?, total_burns = ?,
      current_streak = ?, best_streak = ?,
      last_seen = ?
    WHERE id = ?
  `),
  updateLastSeen: db.prepare('UPDATE players SET last_seen = ? WHERE id = ?'),
  allPlayers: db.prepare('SELECT * FROM players ORDER BY last_seen DESC LIMIT 100'),
};

function rowToPlayer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    coins: row.coins,
    badges: JSON.parse(row.badges || '[]'),
    stats: {
      totalTosses: row.total_tosses,
      hotTosses: row.hot_tosses,
      dangerTosses: row.danger_tosses,
      totalReceived: row.total_received,
      totalBurns: row.total_burns,
      currentStreak: row.current_streak,
      bestStreak: row.best_streak,
    },
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

module.exports = {
  // Find or create a player by name. Returns the DB record as a player object.
  findOrCreatePlayer(name) {
    let row = stmts.getByName.get(name);
    if (row) return rowToPlayer(row);
    // Create new with a temporary UUID id (will be updated to socket id on connect)
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    stmts.insert.run(id, name);
    row = stmts.getById.get(id);
    return rowToPlayer(row);
  },

  // Load player by name (returns null if not found)
  getPlayerByName(name) {
    const row = stmts.getByName.get(name);
    return row ? rowToPlayer(row) : null;
  },

  // Save player state back to DB
  savePlayer(player) {
    stmts.updateStats.run(
      player.coins,
      JSON.stringify(player.badges),
      player.stats.totalTosses,
      player.stats.hotTosses,
      player.stats.dangerTosses,
      player.stats.totalReceived,
      player.stats.totalBurns,
      player.stats.currentStreak,
      player.stats.bestStreak,
      Date.now(),
      player.dbId || player.id
    );
  },

  // Update the DB id when we know the persistent id
  updatePlayerId(oldId, newId) {
    db.prepare('UPDATE players SET id = ? WHERE id = ?').run(newId, oldId);
  },

  updateLastSeen(id) {
    stmts.updateLastSeen.run(Date.now(), id);
  },

  getAllPlayers() {
    return stmts.allPlayers.all().map(rowToPlayer);
  },

  db,
};

// Web Push wrapper. Loads/generates a persistent VAPID keypair, sends
// notifications to a player's stored subscriptions, and prunes dead ones.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const KEYS_PATH = process.env.VAPID_KEYS_PATH || path.join(__dirname, 'data', 'vapid-keys.json');
const CONTACT = process.env.VAPID_CONTACT || 'mailto:hello@potatogame.local';

let keys = null;

function loadOrGenerateKeys() {
  // Env vars take precedence (so Render can inject them)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }
  // Otherwise persist to disk so they survive restarts
  try {
    if (fs.existsSync(KEYS_PATH)) {
      return JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not read VAPID keys file:', e.message);
  }
  const generated = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.dirname(KEYS_PATH), { recursive: true });
    fs.writeFileSync(KEYS_PATH, JSON.stringify(generated, null, 2));
    console.log('Generated new VAPID keypair at', KEYS_PATH);
  } catch (e) {
    console.warn('Could not persist VAPID keys, will regenerate next boot:', e.message);
  }
  return generated;
}

function init() {
  if (keys) return keys;
  keys = loadOrGenerateKeys();
  webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);
  return keys;
}

function getPublicKey() {
  init();
  return keys.publicKey;
}

// Send a push to a single subscription. Returns ok=true on success.
// dead=true means the subscription should be deleted from the DB:
//   404/410 = subscription expired or unknown
//   401/403 = VAPID key mismatch (subscription bound to a different key);
//             the only way to recover is for the client to re-subscribe.
async function sendOne(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const status = err.statusCode || 0;
    if (status === 404 || status === 410 || status === 401 || status === 403) {
      console.warn('[push] dead subscription (' + status + '):', subscription.endpoint.slice(0, 60) + '...');
      return { ok: false, dead: true };
    }
    console.warn('[push] send failed:', status, err.body || err.message);
    return { ok: false, dead: false };
  }
}

// Send to every subscription registered for this player.
// db: the db module (so we can prune dead subs).
async function sendToPlayer(db, playerId, payload) {
  if (!db || !playerId) {
    console.log('[push] sendToPlayer: missing db or playerId', { playerId });
    return { sent: 0, dead: 0, total: 0 };
  }
  init();
  const subs = db.getPushSubscriptionsForPlayer(playerId);
  if (!subs || subs.length === 0) {
    console.log('[push] sendToPlayer: no subscriptions for', playerId);
    return { sent: 0, dead: 0, total: 0 };
  }
  let sent = 0;
  let dead = 0;
  await Promise.all(subs.map(async (sub) => {
    const result = await sendOne(sub, payload);
    if (result.ok) sent++;
    if (result.dead) {
      dead++;
      db.removePushSubscription(sub.endpoint);
    }
  }));
  console.log('[push] sendToPlayer:', playerId, '→', { sent, dead, total: subs.length });
  return { sent, dead, total: subs.length };
}

module.exports = { init, getPublicKey, sendToPlayer };

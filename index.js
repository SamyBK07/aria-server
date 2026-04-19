const express = require(‘express’);
const webpush = require(‘web-push’);
const cron = require(‘node-cron’);
const cors = require(‘cors’);
const Database = require(‘better-sqlite3’);

const app = express();
app.use(cors());
app.use(express.json());

// ══ BASE DE DONNÉES ══
const db = new Database(‘aria.db’);

db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
id TEXT PRIMARY KEY,
subscription TEXT NOT NULL,
created_at TEXT DEFAULT (datetime(‘now’))
);

CREATE TABLE IF NOT EXISTS reminders (
id TEXT PRIMARY KEY,
user_id TEXT NOT NULL,
title TEXT NOT NULL,
date TEXT,
time TEXT NOT NULL,
recur TEXT DEFAULT ‘’,
last_triggered TEXT DEFAULT ‘’,
created_at TEXT DEFAULT (datetime(‘now’))
);
`);

// ══ WEB PUSH KEYS ══
// Ces clés sont générées une fois et stockées en variables d’environnement
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || ‘mailto:aria@aria.app’;

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
console.error(‘❌ VAPID_PUBLIC et VAPID_PRIVATE requis en variables d'environnement’);
console.log(‘Générez-les avec : node generate-keys.js’);
process.exit(1);
}

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// ══ ROUTES ══

// Sanity check
app.get(’/’, (req, res) => res.json({ status: ‘ARIA server running’ }));

// Clé publique VAPID (nécessaire côté PWA pour s’abonner)
app.get(’/vapid-public-key’, (req, res) => {
res.json({ key: VAPID_PUBLIC });
});

// Enregistrer ou mettre à jour l’abonnement push d’un utilisateur
app.post(’/subscribe’, (req, res) => {
const { userId, subscription } = req.body;
if (!userId || !subscription) return res.status(400).json({ error: ‘userId et subscription requis’ });

db.prepare(`INSERT INTO subscriptions (id, subscription) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET subscription = excluded.subscription`).run(userId, JSON.stringify(subscription));

res.json({ ok: true });
});

// Synchroniser les rappels d’un utilisateur
app.post(’/sync-reminders’, (req, res) => {
const { userId, reminders } = req.body;
if (!userId || !Array.isArray(reminders)) return res.status(400).json({ error: ‘userId et reminders requis’ });

// Supprimer les anciens rappels de cet utilisateur
db.prepare(‘DELETE FROM reminders WHERE user_id = ?’).run(userId);

// Insérer les nouveaux
const insert = db.prepare(`INSERT INTO reminders (id, user_id, title, date, time, recur) VALUES (?, ?, ?, ?, ?, ?)`);

for (const r of reminders) {
if (!r.time) continue; // Ignorer les tâches sans heure
insert.run(
`${userId}_${r.id}`,
userId,
r.title,
r.date || ‘’,
r.time,
r.recur || ‘’
);
}

res.json({ ok: true, count: reminders.filter(r => r.time).length });
});

// Envoyer une notif test
app.post(’/test-push’, async (req, res) => {
const { userId } = req.body;
const row = db.prepare(‘SELECT subscription FROM subscriptions WHERE id = ?’).get(userId);
if (!row) return res.status(404).json({ error: ‘Utilisateur non trouvé’ });

try {
await webpush.sendNotification(
JSON.parse(row.subscription),
JSON.stringify({ title: ‘ARIA’, body: ‘Les notifications fonctionnent ! 🎉’ })
);
res.json({ ok: true });
} catch (e) {
res.status(500).json({ error: e.message });
}
});

// ══ SCHEDULER ══
// Tourne chaque minute, vérifie les rappels à déclencher
cron.schedule(’* * * * *’, async () => {
const now = new Date();
const today = now.toISOString().split(‘T’)[0];
const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
const hhmm5 = (() => {
const d = new Date(now.getTime() + 5 * 60000);
return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
})();

// Récupérer tous les rappels qui correspondent à maintenant ou dans 5 min
const reminders = db.prepare(‘SELECT * FROM reminders’).all();

for (const r of reminders) {
const dateOk = !r.date || r.date === today;
if (!dateOk) continue;

```
const isNow   = r.time === hhmm;
const isSoon  = r.time === hhmm5;
if (!isNow && !isSoon) continue;

// Éviter les doublons pour les tâches récurrentes
const triggerKey = `${r.id}_${today}_${isNow ? 'now' : '5min'}`;
const alreadyDone = db.prepare('SELECT 1 FROM reminders WHERE id = ? AND last_triggered = ?').get(r.id, triggerKey);
if (alreadyDone) continue;

// Marquer comme déclenché
db.prepare('UPDATE reminders SET last_triggered = ? WHERE id = ?').run(triggerKey, r.id);

// Récupérer l'abonnement de l'utilisateur
const sub = db.prepare('SELECT subscription FROM subscriptions WHERE id = ?').get(r.user_id);
if (!sub) continue;

const minutesLeft = isSoon ? 5 : 0;
const body = minutesLeft > 0
  ? `Dans ${minutesLeft} min : ${r.title}`
  : `C'est l'heure : ${r.title}`;

try {
  await webpush.sendNotification(
    JSON.parse(sub.subscription),
    JSON.stringify({
      title: 'ARIA',
      body,
      taskId: r.id,
      openApp: true
    })
  );
  console.log(`✅ Notif envoyée → ${r.user_id} : ${body}`);
} catch (e) {
  console.error(`❌ Push failed for ${r.user_id}:`, e.statusCode, e.body);
  // Si le token est invalide (410), supprimer l'abonnement
  if (e.statusCode === 410) {
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(r.user_id);
  }
}
```

}
});

// ══ START ══
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 ARIA server on port ${PORT}`));

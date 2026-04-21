const express = require(‘express’);
const webpush = require(‘web-push’);
const cron = require(‘node-cron’);
const cors = require(‘cors’);
const Database = require(‘better-sqlite3’);

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(‘aria.db’);

db.exec(`CREATE TABLE IF NOT EXISTS subscriptions ( id TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')) ); CREATE TABLE IF NOT EXISTS reminders ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, date TEXT, time TEXT NOT NULL, recur TEXT DEFAULT '', last_triggered TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')) );`);

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || ‘mailto:aria@aria.app’;

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
console.error(‘VAPID_PUBLIC et VAPID_PRIVATE requis’);
process.exit(1);
}

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

app.get(’/’, (req, res) => res.json({ status: ‘ARIA server running’ }));

app.get(’/vapid-public-key’, (req, res) => {
res.json({ key: VAPID_PUBLIC });
});

app.post(’/subscribe’, (req, res) => {
const { userId, subscription } = req.body;
if (!userId || !subscription) return res.status(400).json({ error: ‘userId et subscription requis’ });
db.prepare(‘INSERT INTO subscriptions (id, subscription) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET subscription = excluded.subscription’).run(userId, JSON.stringify(subscription));
res.json({ ok: true });
});

app.post(’/sync-reminders’, (req, res) => {
const { userId, reminders } = req.body;
if (!userId || !Array.isArray(reminders)) return res.status(400).json({ error: ‘userId et reminders requis’ });
db.prepare(‘DELETE FROM reminders WHERE user_id = ?’).run(userId);
const insert = db.prepare(‘INSERT INTO reminders (id, user_id, title, date, time, recur) VALUES (?, ?, ?, ?, ?, ?)’);
for (const r of reminders) {
if (!r.time) continue;
insert.run(userId + ‘_’ + r.id, userId, r.title, r.date || ‘’, r.time, r.recur || ‘’);
}
res.json({ ok: true, count: reminders.filter(r => r.time).length });
});

app.post(’/test-push’, async (req, res) => {
const { userId } = req.body;
const row = db.prepare(‘SELECT subscription FROM subscriptions WHERE id = ?’).get(userId);
if (!row) return res.status(404).json({ error: ‘Utilisateur non trouve’ });
try {
await webpush.sendNotification(JSON.parse(row.subscription), JSON.stringify({ title: ‘ARIA’, body: ‘Les notifications fonctionnent !’ }));
res.json({ ok: true });
} catch (e) {
res.status(500).json({ error: e.message });
}
});

cron.schedule(’* * * * *’, async () => {
const now = new Date();
const today = now.toISOString().split(‘T’)[0];
const hhmm = String(now.getHours()).padStart(2,‘0’) + ‘:’ + String(now.getMinutes()).padStart(2,‘0’);
const d5 = new Date(now.getTime() + 5 * 60000);
const hhmm5 = String(d5.getHours()).padStart(2,‘0’) + ‘:’ + String(d5.getMinutes()).padStart(2,‘0’);

const reminders = db.prepare(‘SELECT * FROM reminders’).all();

for (const r of reminders) {
const dateOk = !r.date || r.date === today;
if (!dateOk) continue;

```
const isNow  = r.time === hhmm;
const isSoon = r.time === hhmm5;
if (!isNow && !isSoon) continue;

const triggerKey = r.id + '_' + today + '_' + (isNow ? 'now' : '5min');
const alreadyDone = db.prepare('SELECT 1 FROM reminders WHERE id = ? AND last_triggered = ?').get(r.id, triggerKey);
if (alreadyDone) continue;

db.prepare('UPDATE reminders SET last_triggered = ? WHERE id = ?').run(triggerKey, r.id);

const sub = db.prepare('SELECT subscription FROM subscriptions WHERE id = ?').get(r.user_id);
if (!sub) continue;

const body = isSoon ? ('Dans 5 min : ' + r.title) : ("C'est l'heure : " + r.title);

try {
  await webpush.sendNotification(
    JSON.parse(sub.subscription),
    JSON.stringify({ title: 'ARIA', body: body, taskId: r.id, openApp: true })
  );
  console.log('Notif envoyee : ' + body);
} catch (e) {
  console.error('Push failed:', e.statusCode, e.body);
  if (e.statusCode === 410) {
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(r.user_id);
  }
}
```

}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(’ARIA server on port ’ + PORT));

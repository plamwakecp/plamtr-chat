const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const multer = require('multer');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const TG_CHANNEL = process.env.TG_CHANNEL || 'https://t.me/plamtr';
const MASTER_KEY_FILE = path.join(__dirname, 'data', 'master.key');

/* ============= MASTER KEY (AES-256-GCM) ============= */
function getMasterKey() {
  if (fs.existsSync(MASTER_KEY_FILE)) return fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
  const k = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(path.dirname(MASTER_KEY_FILE), { recursive: true });
  fs.writeFileSync(MASTER_KEY_FILE, k, { mode: 0o600 });
  return k;
}
const MASTER_KEY = Buffer.from(getMasterKey(), 'base64');

function encBuf(buf, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decBuf(b64, key) {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), data = raw.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}
const encStr = (s, key) => encBuf(Buffer.from(s, 'utf8'), key);
const decStr = (b64, key) => decBuf(b64, key).toString('utf8');

/* ============= DATA FILES ============= */
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const MESSAGES_FILE = path.join(DATA, 'messages.json');
const UPLOAD_DIR = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function saveJSON(f, o) { fs.writeFileSync(f, JSON.stringify(o, null, 2)); }

let users = loadJSON(USERS_FILE, {});
let sessions = loadJSON(SESSIONS_FILE, {});
let messages = loadJSON(MESSAGES_FILE, []);
let groups = loadJSON(path.join(DATA, 'groups.json'), []);

const MAX_MESSAGES = 20000;
const saveUsers = () => saveJSON(USERS_FILE, users);
const saveSessions = () => saveJSON(SESSIONS_FILE, sessions);
const saveGroups = () => saveJSON(path.join(DATA, 'groups.json'), groups);

function pushMessage(m) {
  messages.push(m);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  saveJSON(MESSAGES_FILE, messages);
}

/* ============= X25519 E2E KEYPAIR ============= */
function genKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { pub: pub.toString('base64'), priv: priv.toString('base64') };
}

/* ============= PASSWORD STRENGTH ============= */
function pwError(pw) {
  if (pw.length < 8) return 'Şifre en az 8 karakter olmalı.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Şifre hem harf hem rakam içermeli (örn: Abc12345).';
  return null;
}

/* ============= RECOVERY QUESTIONS ============= */
const RECOVERY_QUESTIONS = [
  { id: 'animal', tr: 'En sevdiğin hayvan hangisidir?' },
  { id: 'city', tr: 'Hangi şehirde doğdun?' },
  { id: 'school', tr: 'İlk okuduğun kitap hangisiydi?' },
  { id: 'game', tr: 'En sevdiğin oyun hangisidir?' },
  { id: 'food', tr: 'En sevdiğin yiyecek nedir?' },
  { id: 'color', tr: 'En sevdiğin renk hangisidir?' },
  { id: 'movie', tr: 'En sevdiğin film hangisidir?' },
  { id: 'music', tr: 'En sevdiğin şarkı hangisidir?' },
  { id: 'custom', tr: 'Kendi sorunu yaz...' }
];

/* ============= SWEAR FILTER ============= */
const SWEARS = [
  'siktir git','sikerim','sikerim seni','allahını sikerim','peygamberini sikerim',
  'amına koyayım','siker','sikersin','sikeceksin','sikecek','sikin','siksin','sikiyor','siktim','siktir','sikmek','sik','sık',
  'amk','amcık','amcik','amına','amina','amcık','amcıgım','amcigim','am','amçık',
  'oranı','orani','orospu','orosbu','anını','anini','ananı','anani','anan','anana','anı','anını',
  'piç','pic','kuzun','piç','piçi','pic','aq','amc','mk','sg','oe','ae','oc','aç','oç','kys','ksy',
  'yavşak','yavsak','geber','gibersin','lan',
  'bacını','bacini','bacın','bacin','karını','karini','karın','karin','kızını','kizini','kızın','kizin','kızı','kizi',
  'allahını','allahini','peygamberini','peygamberıni','peygamberı','peygamberi','ana','anan','orospu'
].filter((v,i,a)=>a.indexOf(v)===i);

function censor(text) {
  let out = text;
  for (const w of SWEARS) {
    const star = '*'.repeat(w.length);
    out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), star);
  }
  return out;
}

function detectHeavy(text) {
  const reasons = [];
  if (/\b\d{11}\b/.test(text)) reasons.push('TC Kimlik Numarası');
  if (/TR\d{24}/i.test(text)) reasons.push('IBAN');
  if (/\b\d{16}\b/.test(text)) reasons.push('Banka Kartı No');
  if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(text)) reasons.push('Banka Kartı No');
  return reasons;
}

/* ============= ADMIN BOOTSTRAP ============= */
function ensureAdmin() {
  const adminName = 'plamwakecp';
  const existing = Object.values(users).find(u => u.username === adminName);
  if (existing) { existing.role = 'admin'; saveUsers(); return; }
  const id = crypto.randomUUID();
  const kp = genKeypair();
  users[id] = {
    id, username: adminName, displayName: 'Plamwakecp',
    email: '', recoveryQuestionId: 'custom', recoveryQuestionText: '', recoveryAnswerHash: '',
    passwordHash: bcrypt.hashSync('43ggao582!AOT', 12),
    pub: kp.pub, coins: 999999, vip: true, role: 'admin',
    banned: false, banReason: '', bannedUntil: null,
    bio: 'Kurucu & Admin', photo: '', animatedPhoto: '', background: '',
    frame: 'rainbow', effects: [], friends: [], pendingFriends: [],
    theme: 'dark', filterOn: true, warnings: [], createdAt: Date.now()
  };
  saveUsers();
}
ensureAdmin();

/* ============= EXPRESS APP ============= */
const app = express();
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'Çok fazla istek, lütfen 15 dk bekleyin.' } });
app.use('/api/', limiter);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, f, cb) => cb(null, crypto.randomUUID() + '.' + (f.originalname.split('.').pop() || 'bin'))
});
const upload = multer({ storage, limits: { fileSize: 50*1024*1024 } });

function encryptFileOnDisk(p) {
  const raw = fs.readFileSync(p);
  const enc = encBuf(raw, MASTER_KEY);
  const encPath = p + '.enc';
  fs.writeFileSync(encPath, enc, 'base64');
  fs.unlinkSync(p);
  return path.basename(encPath);
}
function decryptFileToSend(p, cb) {
  const enc = fs.readFileSync(p, 'base64');
  const raw = decBuf(enc, MASTER_KEY);
  cb(raw);
}

/* ============= AUTH ============= */
function authUser(req, res) {
  const t = req.get('x-token');
  if (!t || !sessions[t]) { res.status(401).json({ error: 'Giriş yapmalısın.' }); return null; }
  return users[sessions[t].uid];
}

function publicUser(u) {
  const { passwordHash, recoveryAnswerHash, ...rest } = u;
  return rest;
}

/* ============= AUTH API ============= */
app.get('/api/recovery-questions', (req, res) => res.json(RECOVERY_QUESTIONS));

app.post('/api/register', (req, res) => {
  const { fullName, username, email, questionId, questionText, answer, password } = req.body;
  if (!fullName || fullName.trim().length < 2) return res.json({ error: 'Adını yaz.' });
  const u = (username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return res.json({ error: 'Kullanıcı adı 3-20 karakter, sadece küçük harf/rakam/_ olabilir.' });
  if (Object.values(users).some(x => x.username === u)) return res.json({ error: 'Bu kullanıcı adı zaten alınmış!' });
  const pe = pwError(password || '');
  if (pe) return res.json({ error: pe });
  if (!answer || !answer.trim()) return res.json({ error: 'Kurtarma sorusu cevabını yaz.' });
  const id = crypto.randomUUID();
  const kp = genKeypair();
  users[id] = {
    id, username: u, displayName: fullName.trim(),
    email: (email || '').trim().toLowerCase(),
    recoveryQuestionId: questionId || 'animal',
    recoveryQuestionText: questionId === 'custom' ? (questionText || '') : '',
    recoveryAnswerHash: bcrypt.hashSync(answer.trim().toLowerCase(), 10),
    passwordHash: bcrypt.hashSync(password, 12),
    pub: kp.pub,
    coins: 200, vip: false, vipUntil: null, role: 'user',
    banned: false, banReason: '', bannedUntil: null,
    bio: '', photo: '', animatedPhoto: '', background: '',
    frame: 'none', effects: [], friends: [], pendingFriends: [],
    theme: 'light', filterOn: true, warnings: [], createdAt: Date.now()
  };
  saveUsers();
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { uid: id, created: Date.now() };
  saveSessions();
  res.json({ ok: true, token, user: publicUser(users[id]), keypair: kp });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = Object.values(users).find(x => x.username === (username || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.passwordHash)) return res.json({ error: 'Kullanıcı adı veya şifre yanlış.' });
  if (u.banned) {
    if (u.bannedUntil && Date.now() > u.bannedUntil) { u.banned = false; u.banReason = ''; u.bannedUntil = null; saveUsers(); }
    else return res.json({ error: 'Hesabın yasaklı: ' + (u.banReason || 'genel yasak') });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { uid: u.id, created: Date.now() };
  saveSessions();
  res.json({ ok: true, token, user: publicUser(u), keypair: genKeypair() });
});

app.post('/api/logout', (req, res) => {
  const t = req.get('x-token');
  if (t && sessions[t]) { delete sessions[t]; saveSessions(); }
  res.json({ ok: true });
});

app.post('/api/forgot', (req, res) => {
  const { username, method, answer } = req.body;
  const u = Object.values(users).find(x => x.username === (username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Kullanıcı bulunamadı.' });
  if (method === 'question') {
    if (bcrypt.compareSync((answer || '').trim().toLowerCase(), u.recoveryAnswerHash)) {
      const code = crypto.randomInt(100000, 999999).toString();
      sessions['recovery_' + u.username] = { code, t: Date.now() };
      saveSessions();
      return res.json({ ok: true, code });
    }
    return res.json({ error: 'Cevap yanlış.' });
  }
  if (method === 'email') {
    if (!u.email) return res.json({ error: 'E-posta eklenmemiş.' });
    const code = crypto.randomInt(100000, 999999).toString();
    sessions['recovery_' + u.username] = { code, t: Date.now() };
    saveSessions();
    return res.json({ ok: true, code, email: u.email });
  }
});

app.post('/api/resetpw', (req, res) => {
  const { username, code, newPassword } = req.body;
  const u = Object.values(users).find(x => x.username === (username || '').trim().toLowerCase());
  const s = sessions['recovery_' + (username || '').trim().toLowerCase()];
  if (!u || !s || s.code !== code || Date.now() - s.t > 5*60*1000) return res.json({ error: 'Kod yanlış veya süresi dolmuş.' });
  const pe = pwError(newPassword || '');
  if (pe) return res.json({ error: pe });
  u.passwordHash = bcrypt.hashSync(newPassword, 12);
  delete sessions['recovery_' + u.username];
  saveUsers(); saveSessions();
  res.json({ ok: true });
});

/* ============= USER LOOKUP ============= */
app.get('/api/user/:name', (req, res) => {
  const u = Object.values(users).find(x => x.username === req.params.name.toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  res.json({ user: publicUser(u), online: isOnline(u.id) });
});
app.get('/api/username-check/:name', (req, res) => {
  const taken = Object.values(users).some(x => x.username === req.params.name.toLowerCase());
  res.json({ taken });
});

/* ============= PROFILE ============= */
app.get('/api/profile', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  res.json({ user: publicUser(me) });
});
app.put('/api/profile', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const { displayName, bio, frame, effects, theme, filterOn } = req.body;
  if (displayName !== undefined) me.displayName = displayName.trim().slice(0, 30);
  if (bio !== undefined) me.bio = bio.trim().slice(0, 200);
  if (frame !== undefined) me.frame = me.vip ? frame : 'none';
  if (effects !== undefined) me.effects = (me.vip ? effects : []).slice(0, 6);
  if (theme !== undefined) me.theme = theme;
  if (filterOn !== undefined) me.filterOn = !!filterOn;
  saveUsers();
  res.json({ ok: true, user: publicUser(me) });
});

/* ============= FILE UPLOAD ============= */
app.post('/api/upload', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  upload.single('file')(req, res, (err) => {
    if (err) return res.json({ error: 'Dosya çok büyük (max 50MB).' });
    const encName = encryptFileOnDisk(req.file.path);
    res.json({ ok: true, file: 'uploads/' + encName, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
  });
});

app.get('/api/file/:name', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const p = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Yok' });
  decryptFileToSend(p, (raw) => { res.send(raw); });
});

/* VIP photo/animated/background */
app.post('/api/photo', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  if (!me.vip) return res.json({ error: 'Profil fotoğrafı VIP özelliği.' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.json({ error: 'Çok büyük.' });
    me.photo = 'uploads/' + encryptFileOnDisk(req.file.path);
    saveUsers(); res.json({ ok: true, user: publicUser(me) });
  });
});
app.post('/api/animatedphoto', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  if (!me.vip) return res.json({ error: 'Hareketli profil VIP özelliği.' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.json({ error: 'Çok büyük.' });
    me.animatedPhoto = 'uploads/' + encryptFileOnDisk(req.file.path);
    saveUsers(); res.json({ ok: true, user: publicUser(me) });
  });
});
app.post('/api/background', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  if (!me.vip) return res.json({ error: 'Profil arka planı VIP özelliği.' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.json({ error: 'Çok büyük.' });
    me.background = 'uploads/' + encryptFileOnDisk(req.file.path);
    saveUsers(); res.json({ ok: true, user: publicUser(me) });
  });
});

/* ============= COINS & SHOP ============= */
const SHOP = {
  frames: [
    { id: 'gold', name: 'Altın Çerçeve', price: 100 },
    { id: 'rainbow', name: 'Gökkuşağı Çerçeve', price: 150 },
    { id: 'fire', name: 'Ateş Çerçeve', price: 150 },
    { id: 'star', name: 'Yıldız Çerçeve', price: 200 }
  ],
  effects: [
    { id: 'fire_msg', name: 'Ateş Mesaj', price: 100 },
    { id: 'rainbow_msg', name: 'Gökkuşağı Mesaj', price: 150 },
    { id: 'neon_msg', name: 'Neon Mesaj', price: 150 },
    { id: 'glitter_msg', name: 'Pırıltı Mesaj', price: 200 }
  ]
};
app.get('/api/shop', (req, res) => res.json(SHOP));
app.post('/api/shop/buy', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const { kind, id } = req.body;
  const item = SHOP[kind].find(x => x.id === id);
  if (!item) return res.json({ error: 'Yok' });
  if (me.coins < item.price) return res.json({ error: 'Yetersiz coin. TG kanalımızdan coin alabilirsin: ' + TG_CHANNEL });
  me.coins -= item.price;
  if (kind === 'frames') { if (!me.vip) return res.json({ error: 'Çerçeve VIP özelliği.' }); me.frame = id; }
  else { if (!me.effects.includes(id)) me.effects.push(id); }
  saveUsers();
  res.json({ ok: true, coins: me.coins, user: publicUser(me) });
});

/* ============= FRIENDS ============= */
app.post('/api/friends/add', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const t = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!t) return res.json({ error: 'Kullanıcı yok.' });
  if (t.id === me.id) return res.json({ error: 'Kendine arkadaş ekleyemezsin.' });
  if (me.friends.includes(t.id)) return res.json({ error: 'Zaten arkadaşsınız.' });
  if (me.pendingFriends.includes(t.id)) return res.json({ error: 'Zaten istek gönderilmiş.' });
  me.pendingFriends.push(t.id); saveUsers();
  wsSend(t.id, { type: 'friend_request', from: me.username, fromName: me.displayName });
  res.json({ ok: true });
});
app.post('/api/friends/accept', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const other = users[req.body.id];
  if (!other) return res.json({ error: 'Yok' });
  me.friends.push(other.id); other.friends.push(me.id);
  other.pendingFriends = other.pendingFriends.filter(x => x !== me.id);
  me.pendingFriends = me.pendingFriends.filter(x => x !== other.id);
  saveUsers();
  wsSend(other.id, { type: 'friend_accepted', from: me.username });
  res.json({ ok: true, user: publicUser(me) });
});
app.post('/api/friends/decline', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  me.pendingFriends = me.pendingFriends.filter(x => x !== req.body.id);
  saveUsers(); res.json({ ok: true });
});
app.delete('/api/friends/:id', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  me.friends = me.friends.filter(x => x !== req.params.id);
  const o = users[req.params.id]; if (o) o.friends = o.friends.filter(x => x !== me.id);
  saveUsers(); res.json({ ok: true });
});

/* ============= GROUPS ============= */
app.get('/api/groups', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  res.json({ groups: groups.filter(g => g.owner === me.id || g.members.includes(me.id)) });
});
app.post('/api/groups', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const g = { id: crypto.randomUUID(), name: (req.body.name || 'Grup').slice(0, 30),
    owner: me.id, members: [me.id], invites: [], key: crypto.randomBytes(32).toString('hex'), createdAt: Date.now() };
  groups.push(g); saveGroups();
  res.json({ ok: true, group: g });
});
app.post('/api/groups/:id/invite', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const g = groups.find(x => x.id === req.params.id); if (!g) return res.json({ error: 'Yok' });
  if (g.owner !== me.id) return res.json({ error: 'Sadece grup sahibi davet edebilir.' });
  const t = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!t) return res.json({ error: 'Kullanıcı yok.' });
  if (g.members.includes(t.id)) return res.json({ error: 'Zaten grupta.' });
  g.invites.push(t.id); saveGroups();
  wsSend(t.id, { type: 'group_invite', groupId: g.id, groupName: g.name, from: me.username });
  res.json({ ok: true });
});
app.post('/api/groups/:id/accept', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const g = groups.find(x => x.id === req.params.id); if (!g) return res.json({ error: 'Yok' });
  g.members.push(me.id); g.invites = g.invites.filter(x => x !== me.id); saveGroups();
  res.json({ ok: true, group: g });
});
app.post('/api/groups/:id/decline', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const g = groups.find(x => x.id === req.params.id); if (!g) return res.json({ error: 'Yok' });
  g.invites = g.invites.filter(x => x !== me.id); saveGroups();
  res.json({ ok: true });
});
app.delete('/api/groups/:id', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  const g = groups.find(x => x.id === req.params.id); if (!g) return res.json({ error: 'Yok' });
  if (g.owner !== me.id) return res.json({ error: 'Sadece grup sahibi silebilir.' });
  groups = groups.filter(x => x.id !== g.id); saveGroups();
  res.json({ ok: true });
});

/* ============= ADMIN API (PC'den yönetim) ============= */
app.get('/api/admin/check', (req, res) => {
  const me = authUser(req, res); if (!me) return;
  res.json({ admin: me.role === 'admin' });
});

app.post('/api/admin/lookup', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Kullanıcı bulunamadı.' });
  res.json({ user: publicUser(u) });
});

app.post('/api/admin/ban', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  u.banned = true; u.banReason = req.body.reason || 'Admin yasağı'; u.bannedUntil = req.body.duration ? Date.now() + req.body.duration : null;
  saveUsers();
  wsSend(u.id, { type: 'banned', reason: u.banReason });
  res.json({ ok: true });
});
app.post('/api/admin/unban', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  u.banned = false; u.banReason = ''; u.bannedUntil = null; saveUsers();
  res.json({ ok: true });
});
app.post('/api/admin/warn', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  u.warnings.push({ reason: req.body.reason || 'Uyarı', by: me.id, at: Date.now() });
  saveUsers();
  wsSend(u.id, { type: 'warn', reason: req.body.reason });
  res.json({ ok: true, warnings: u.warnings.length });
});
app.post('/api/admin/vip', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  u.vip = req.body.set !== false; u.vipUntil = u.vip ? null : null; saveUsers();
  res.json({ ok: true, vip: u.vip });
});
app.post('/api/admin/coins', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  u.coins = (u.coins || 0) + (req.body.amount || 0); saveUsers();
  res.json({ ok: true, coins: u.coins });
});
app.post('/api/admin/deleteuser', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const u = Object.values(users).find(x => x.username === (req.body.username || '').trim().toLowerCase());
  if (!u) return res.json({ error: 'Yok' });
  delete users[u.id];
  for (const t in sessions) { if (sessions[t].uid === u.id) delete sessions[t]; }
  saveUsers(); saveSessions();
  res.json({ ok: true });
});
app.post('/api/admin/broadcast', (req, res) => {
  const me = authUser(req, res); if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Yetki yok.' });
  const msg = (req.body.message || '').trim();
  if (!msg) return res.json({ error: 'Mesaj yaz.' });
  broadcast({ type: 'admin_broadcast', message: msg, from: '📢 Admin' });
  res.json({ ok: true });
});

/* ============= WEB SOCKET SERVER ============= */
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const online = {}; // uid -> ws

function isOnline(uid) { return !!online[uid]; }

function wsSend(uid, data) {
  const ws = online[uid];
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const uid in online) {
    const ws = online[uid];
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastToRoom(room, data, excludeUid) {
  const msg = JSON.stringify(data);
  for (const uid in online) {
    if (uid === excludeUid) continue;
    const ws = online[uid];
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

const ROOMS = ['genel1', 'genel2', 'genel3'];

wss.on('connection', (ws, req) => {
  let user = null;
  let currentRoom = 'genel1';
  let heartbeatTimer = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const { type } = data;

      if (type === 'auth') {
        const t = data.token;
        if (!t || !sessions[t]) { ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz token.' })); return; }
        user = users[sessions[t].uid];
        if (!user) { ws.send(JSON.stringify({ type: 'error', message: 'Kullanıcı bulunamadı.' })); return; }
        online[user.id] = ws;
        ws.send(JSON.stringify({ type: 'auth_ok', user: publicUser(user), rooms: ROOMS }));
        broadcast({ type: 'user_online', uid: user.id, username: user.username });
        return;
      }

      if (!user) { ws.send(JSON.stringify({ type: 'error', message: 'Önce giriş yap (auth).' })); return; }

      if (type === 'join') {
        currentRoom = data.room || 'genel1';
        if (!ROOMS.includes(currentRoom)) currentRoom = 'genel1';
        ws.send(JSON.stringify({ type: 'joined', room: currentRoom }));
        return;
      }

      if (type === 'message') {
        let text = (data.text || '').trim();
        if (!text) return;
        const heavy = detectHeavy(text);
        if (heavy.length > 0) {
          broadcast({ type: 'heavy_alert', uid: user.id, username: user.username, displayName: user.displayName, reasons: heavy });
          text = '🚨 ' + heavy.join(', ') + ' tespit edildi!';
        }
        if (user.filterOn) text = censor(text);
        const room = data.room || currentRoom;
        const msg = {
          type: 'message',
          room,
          from: user.id,
          username: user.username,
          displayName: user.displayName,
          text,
          time: Date.now(),
          frame: user.frame,
          effects: user.effects,
          vip: user.vip,
          role: user.role
        };
        if (room === 'dm' && data.to) {
          msg.to = data.to;
          wsSend(data.to, msg);
          wsSend(user.id, msg);
          pushMessage({ id: crypto.randomUUID(), room: 'dm:' + user.id + ':' + data.to, from: user.id, to: data.to, text: encStr(text, MASTER_KEY), time: Date.now() });
        } else if (ROOMS.includes(room)) {
          broadcast(msg);
          pushMessage({ id: crypto.randomUUID(), room, from: user.id, text: encStr(text, MASTER_KEY), time: Date.now() });
        } else {
          // grup mesajı
          const g = groups.find(x => x.id === room);
          if (g && g.members.includes(user.id)) {
            broadcastToRoom(room, msg);
            wsSend(user.id, msg);
            pushMessage({ id: crypto.randomUUID(), room: 'group:' + room, from: user.id, text: encStr(text, MASTER_KEY), time: Date.now() });
          }
        }
        return;
      }

      if (type === 'call_offer' || type === 'call_answer' || type === 'ice_candidate') {
        if (data.to) wsSend(data.to, { ...data, from: user.id, fromUser: user.username });
        return;
      }

      if (type === 'typing') {
        if (data.to) wsSend(data.to, { type: 'typing', from: user.id, fromUser: user.username });
        return;
      }

      if (type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    } catch (e) { console.error('WS error:', e.message); }
  });

  ws.on('close', () => {
    if (user) {
      delete online[user.id];
      broadcast({ type: 'user_offline', uid: user.id, username: user.username });
    }
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });

  ws.on('error', () => {
    if (user) { delete online[user.id]; broadcast({ type: 'user_offline', uid: user.id, username: user.username }); }
  });
});

/* ============= START ============= */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PlamTR server running on port ${PORT}`);
  console.log(`🔐 Master key: ${MASTER_KEY_FILE}`);
  console.log(`👑 Admin: plamwakecp`);
  console.log(`📢 TG Kanal: ${TG_CHANNEL}`);
});
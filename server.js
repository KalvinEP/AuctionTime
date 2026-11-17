// Private player auction — no dependencies, needs Node 18+.
// Run:  ADMIN_KEY=yoursecret node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
if (!ADMIN_KEY) { console.error('Set the ADMIN_KEY environment variable first.'); process.exit(1); }

let db = { players: [], bidders: [], bids: [], sessions: {}, closeAt: null, open: false, increment: 10, startPrice: 10, currency: 'R' };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch {}
const save = () => { fs.writeFileSync(DATA + '.tmp', JSON.stringify(db)); fs.renameSync(DATA + '.tmp', DATA); };

const now = () => Date.now();
const norm = p => String(p || '').replace(/\D/g, '').slice(-9);          // 082 123 4567 and +27821234567 match
const nameOf = phone => (db.bidders.find(b => b.phone === phone) || {}).name || null;
const playerName = id => (db.players.find(p => p.id === id) || {}).name || '?';

function status() {
  if (!db.closeAt) return 'pending';
  if (now() >= db.closeAt) return 'closed';
  return db.open ? 'open' : 'pending';
}

function view(phone) {
  const last = {}, count = {};
  for (const b of db.bids) { last[b.pid] = b; count[b.pid] = (count[b.pid] || 0) + 1; }
  let pool = 0, mine = 0;
  const players = db.players.map(p => {
    const b = last[p.id], amount = b ? b.amount : 0, isMine = !!b && b.phone === phone;
    pool += amount; if (isMine) mine += amount;
    return { id: p.id, name: p.name, amount, bids: count[p.id] || 0, leader: b ? nameOf(b.phone) : null, mine: isMine,
             min: b ? amount + db.increment : Math.max(db.startPrice, 1) };
  });
  return {
    status: status(), closeAt: db.closeAt, serverTime: now(), currency: db.currency, increment: db.increment,
    pool, mine, me: nameOf(phone), players,
    recent: db.bids.slice(-10).reverse().map(b => ({ player: playerName(b.pid), amount: b.amount, who: nameOf(b.phone), t: b.t }))
  };
}

// ---------- live updates (Server-Sent Events) ----------
const clients = new Set();
function broadcast() {
  for (const c of clients) { try { c.res.write(`data: ${JSON.stringify(view(c.phone))}\n\n`); } catch {} }
}
let lastStatus = status();
setInterval(() => { const s = status(); if (s !== lastStatus) { lastStatus = s; broadcast(); } }, 1000);
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch {} } }, 20000);

// ---------- helpers ----------
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) { req.destroy(); no(); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(); } });
});
const phoneFor = (req, url) => db.sessions[req.headers['x-token'] || url.searchParams.get('token') || ''] || null;
const isAdmin = (req, url) => {
  const k = String(req.headers['x-admin-key'] || url.searchParams.get('key') || '');
  return k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
};
const fails = new Map(); // ip -> [timestamps]
const tooMany = ip => { const a = (fails.get(ip) || []).filter(t => now() - t < 600000); fails.set(ip, a); return a.length >= 10; };
const newPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function serveStatic(res, file) {
  fs.readFile(path.join(__dirname, 'public', file), (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' }); res.end(d);
  });
}

// ---------- server ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, 'index.html');
    if (req.method === 'GET' && p === '/admin') return serveStatic(res, 'admin.html');

    // --- bidder API ---
    if (p === '/api/login' && req.method === 'POST') {
      if (tooMany(ip)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const b = await readBody(req);
      const bd = db.bidders.find(x => x.phone === norm(b.phone) && x.pin === String(b.pin || '').trim());
      if (!bd) { fails.get(ip).push(now()); return send(res, 401, { error: 'Wrong phone number or PIN.' }); }
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = bd.phone; save();
      return send(res, 200, { token });
    }

    if (p === '/api/state' && req.method === 'GET') {
      const phone = phoneFor(req, url); if (!phone) return send(res, 401, { error: 'Login required' });
      return send(res, 200, view(phone));
    }

    if (p === '/api/events' && req.method === 'GET') {
      const phone = phoneFor(req, url); if (!phone) return send(res, 401, { error: 'Login required' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify(view(phone))}\n\n`);
      const c = { res, phone }; clients.add(c);
      req.on('close', () => clients.delete(c));
      return;
    }

    if (p === '/api/bid' && req.method === 'POST') {
      const phone = phoneFor(req, url); if (!phone) return send(res, 401, { error: 'Login required' });
      if (status() !== 'open') return send(res, 400, { error: status() === 'closed' ? 'Bidding has closed.' : 'Bidding is not open yet.' });
      const b = await readBody(req);
      const pid = Number(b.playerId), amount = Number(b.amount);
      const pl = view(phone).players.find(x => x.id === pid);
      if (!pl) return send(res, 400, { error: 'Unknown player.' });
      if (!Number.isInteger(amount)) return send(res, 400, { error: 'Enter a whole number.' });
      if (pl.mine) return send(res, 400, { error: 'You already hold the top bid on this player.' });
      if (amount < pl.min) return send(res, 400, { error: `Minimum bid is ${db.currency} ${pl.min}.` });
      db.bids.push({ pid, phone, amount, t: now() }); save();
      broadcast();
      return send(res, 200, { ok: true });
    }

    // --- admin API ---
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req, url)) return send(res, 401, { error: 'Wrong admin key.' });

      if (p === '/api/admin/data' && req.method === 'GET') {
        const { sessions, ...rest } = db;
        return send(res, 200, { ...rest, view: view(''), status: status() });
      }
      if (p === '/api/admin/config' && req.method === 'POST') {
        const b = await readBody(req);
        if (Array.isArray(b.players)) {
          if (db.bids.length) return send(res, 400, { error: 'Bids already exist. Reset bids before changing the player list.' });
          db.players = b.players.map(n => String(n).trim()).filter(Boolean).map((name, i) => ({ id: i + 1, name }));
        }
        if ('closeAt' in b) db.closeAt = b.closeAt ? new Date(b.closeAt).getTime() : null;
        if ('open' in b) db.open = !!b.open;
        if (b.increment) db.increment = Math.max(1, parseInt(b.increment, 10) || 1);
        if ('startPrice' in b) db.startPrice = Math.max(1, parseInt(b.startPrice, 10) || 1);
        if (typeof b.currency === 'string') db.currency = b.currency.slice(0, 4);
        save(); broadcast();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/bidders' && req.method === 'POST') {
        const b = await readBody(req);
        for (const line of String(b.text || '').split('\n')) {
          const [name, phone, pin] = line.split(',').map(s => s.trim());
          if (!name || !norm(phone)) continue;
          const ph = norm(phone), ex = db.bidders.find(x => x.phone === ph);
          if (ex) { ex.name = name; if (pin) ex.pin = pin; }
          else db.bidders.push({ name, phone: ph, pin: pin || newPin() });
        }
        save();
        return send(res, 200, { bidders: db.bidders });
      }
      if (p === '/api/admin/bidders/delete' && req.method === 'POST') {
        const b = await readBody(req);
        db.bidders = db.bidders.filter(x => x.phone !== norm(b.phone));
        for (const t of Object.keys(db.sessions)) if (db.sessions[t] === norm(b.phone)) delete db.sessions[t];
        save(); return send(res, 200, { bidders: db.bidders });
      }
      if (p === '/api/admin/reset' && req.method === 'POST') { db.bids = []; save(); broadcast(); return send(res, 200, { ok: true }); }
      if (p === '/api/admin/results.csv' && req.method === 'GET') {
        const v = view('');
        const rows = ['Player,Winning bid,Winner,Number of bids', ...v.players.map(x => `"${x.name}",${x.amount},"${x.leader || ''}",${x.bids}`), `TOTAL POOL,${v.pool},,`];
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=auction-results.csv' });
        return res.end(rows.join('\n'));
      }
    }

    res.writeHead(404); res.end('Not found');
  } catch (e) { send(res, 400, { error: 'Bad request' }); }
}).listen(PORT, () => console.log(`Auction running on http://localhost:${PORT}  (admin: /admin)`));

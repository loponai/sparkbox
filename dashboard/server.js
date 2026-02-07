const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const docker = require('./lib/docker');
const modules = require('./lib/modules');
const config = require('./lib/config');
const backup = require('./lib/backup');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 8443;
const SB_ROOT = process.env.SB_ROOT || '/opt/sparkbox';

// --- Logging ---
function log(level, msg, err) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  if (level === 'ERROR') {
    console.error(line, err ? err.stack || err : '');
  } else {
    console.log(line);
  }
}

// Use a dedicated session secret, never reuse the password hash
const SESSION_SECRET = process.env.SB_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// --- Security Middleware ---

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// --- Auth Middleware ---

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/');
}

// --- Auth Routes ---

app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  const storedHash = process.env.SB_ADMIN_PASSWORD_HASH || '';

  if (!storedHash) {
    // No password set - require password creation, don't auto-grant access
    if (!password || password.length < 8) {
      return res.status(400).json({
        error: 'Please set a password (minimum 8 characters).',
        firstRun: true
      });
    }
    // Hash and save the new password
    try {
      const hash = await bcrypt.hash(password, 12);
      await config.update(SB_ROOT, { SB_ADMIN_PASSWORD_HASH: hash });
      process.env.SB_ADMIN_PASSWORD_HASH = hash;
      req.session.authenticated = true;
      return res.json({ success: true, firstRun: true });
    } catch (err) {
      log('ERROR', 'Failed to save password', err);
      return res.status(500).json({ error: 'Failed to save password. Try again.' });
    }
  }

  // Compare password - support both bcrypt hashes and legacy SHA-256
  try {
    let valid = false;
    if (storedHash.startsWith('$2')) {
      // bcrypt hash
      valid = await bcrypt.compare(password || '', storedHash);
    } else {
      // Legacy SHA-256 hash - compare and upgrade
      const inputHash = crypto.createHash('sha256').update(password || '').digest('hex');
      valid = inputHash === storedHash;
      if (valid) {
        // Auto-upgrade to bcrypt
        const newHash = await bcrypt.hash(password, 12);
        await config.update(SB_ROOT, { SB_ADMIN_PASSWORD_HASH: newHash });
        process.env.SB_ADMIN_PASSWORD_HASH = newHash;
      }
    }

    if (valid) {
      req.session.authenticated = true;
      return res.json({ success: true });
    }
  } catch (err) {
    log('ERROR', 'Login comparison failed', err);
  }

  res.status(401).json({ error: 'Wrong password. Try again?' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  const hasPassword = !!process.env.SB_ADMIN_PASSWORD_HASH;
  res.json({
    authenticated: !!(req.session && req.session.authenticated),
    firstRun: !hasPassword
  });
});

// --- Module Routes ---

app.get('/api/modules', requireAuth, async (req, res) => {
  try {
    const mods = await modules.list(SB_ROOT);
    res.json(mods);
  } catch (err) {
    log('ERROR', 'Failed to load modules', err);
    res.status(500).json({ error: 'Failed to load modules.' });
  }
});

// Rich metadata from x-sparkbox compose extensions (for App Store UI)
app.get('/api/modules/store', requireAuth, async (req, res) => {
  try {
    const mods = await modules.listRich(SB_ROOT);
    res.json(mods);
  } catch (err) {
    log('ERROR', 'Failed to load store data', err);
    res.status(500).json({ error: 'Failed to load app store data.' });
  }
});

app.post('/api/modules/:name/enable', requireAuth, async (req, res) => {
  try {
    await modules.enable(SB_ROOT, req.params.name);
    res.json({ success: true });
  } catch (err) {
    log('ERROR', `Failed to enable module: ${req.params.name}`, err);
    res.status(400).json({ error: 'Failed to enable module.' });
  }
});

app.post('/api/modules/:name/disable', requireAuth, async (req, res) => {
  try {
    await modules.disable(SB_ROOT, req.params.name);
    res.json({ success: true });
  } catch (err) {
    log('ERROR', `Failed to disable module: ${req.params.name}`, err);
    res.status(400).json({ error: 'Failed to disable module.' });
  }
});

// --- Container Routes ---

app.get('/api/containers', requireAuth, async (req, res) => {
  try {
    const containers = await docker.listContainers();
    res.json(containers);
  } catch (err) {
    log('ERROR', 'Failed to load containers', err);
    res.status(500).json({ error: 'Failed to load containers.' });
  }
});

app.get('/api/containers/:id/stats', requireAuth, async (req, res) => {
  try {
    const stats = await docker.getContainerStats(req.params.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get container stats.' });
  }
});

app.post('/api/containers/:id/restart', requireAuth, async (req, res) => {
  try {
    await docker.restartContainer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Container not found' ? 404 : 500)
       .json({ error: err.message === 'Container not found' ? err.message : 'Failed to restart container.' });
  }
});

app.post('/api/containers/:id/stop', requireAuth, async (req, res) => {
  try {
    await docker.stopContainer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Container not found' ? 404 : 500)
       .json({ error: err.message === 'Container not found' ? err.message : 'Failed to stop container.' });
  }
});

app.post('/api/containers/:id/start', requireAuth, async (req, res) => {
  try {
    await docker.startContainer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Container not found' ? 404 : 500)
       .json({ error: err.message === 'Container not found' ? err.message : 'Failed to start container.' });
  }
});

// --- Config Routes ---

// Allowed config keys that can be modified through the dashboard
const ALLOWED_CONFIG_KEYS = new Set([
  'SB_DOMAIN', 'TZ', 'SB_ADMIN_PASSWORD_HASH',
  'PIHOLE_PASSWORD', 'VAULTWARDEN_SIGNUPS', 'VAULTWARDEN_DOMAIN',
  'NEXTCLOUD_DB_PASSWORD', 'NEXTCLOUD_DB_ROOT_PASSWORD',
  'WG_HOST',
]);

app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await config.read(SB_ROOT);
    // Strip sensitive values
    const safe = {};
    for (const [key, value] of Object.entries(cfg)) {
      if (key.includes('PASSWORD') || key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY')) {
        safe[key] = value ? '********' : '';
      } else {
        safe[key] = value;
      }
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load configuration.' });
  }
});

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    // Validate keys against allowlist
    const updates = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (!ALLOWED_CONFIG_KEYS.has(key)) {
        return res.status(400).json({ error: `Configuration key "${key}" is not allowed.` });
      }
      // Reject values with newlines or shell metacharacters
      if (typeof value === 'string' && /[\n\r`$]/.test(value)) {
        return res.status(400).json({ error: `Invalid characters in value for "${key}".` });
      }
      updates[key] = value;
    }
    await config.update(SB_ROOT, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save configuration.' });
  }
});

// --- Update Routes ---

const updateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1,
  message: { error: 'Updates are limited to once per 5 minutes.' },
});

app.post('/api/update', requireAuth, updateLimiter, async (req, res) => {
  try {
    const result = await docker.pullAndRecreate(SB_ROOT);
    res.json({ success: true, result });
  } catch (err) {
    log('ERROR', 'Update failed', err);
    res.status(500).json({ error: 'Update failed. Check logs for details.' });
  }
});

// --- Backup Routes ---

const backupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  message: { error: 'Backups are limited to one per minute.' },
});

app.post('/api/backup', requireAuth, backupLimiter, async (req, res) => {
  try {
    const file = await backup.create(SB_ROOT);
    res.json({ success: true, file });
  } catch (err) {
    log('ERROR', 'Failed to create backup', err);
    res.status(500).json({ error: 'Failed to create backup.' });
  }
});

app.get('/api/backups', requireAuth, async (req, res) => {
  try {
    const backups = await backup.list(SB_ROOT);
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups.' });
  }
});

app.get('/api/backups/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    let filePath;

    if (filename.endsWith('.enc')) {
      // Decrypt before download
      filePath = await backup.decrypt(SB_ROOT, filename);
      const downloadName = filename.replace('.enc', '');
      res.download(filePath, downloadName);
    } else {
      filePath = await backup.getPath(SB_ROOT, filename);
      res.download(filePath);
    }
  } catch (err) {
    res.status(404).json({ error: 'Backup not found.' });
  }
});

// --- System Info ---

app.get('/api/system', requireAuth, async (req, res) => {
  try {
    const info = await docker.getSystemInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load system info.' });
  }
});

app.get('/api/system/stats', requireAuth, async (req, res) => {
  try {
    const stats = await docker.getHostStats();
    res.json(stats);
  } catch (err) {
    log('ERROR', 'Failed to get host stats', err);
    res.status(500).json({ error: 'Failed to load system stats.' });
  }
});

// --- Socket.IO: Real-time Logs + Status ---

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.authenticated) {
    socket.disconnect();
    return;
  }

  // Log streaming - limit to one subscription at a time
  let activeLogStream = null;
  socket.on('logs:subscribe', async (containerId) => {
    // Clean up previous stream
    if (activeLogStream) { activeLogStream.destroy(); activeLogStream = null; }
    try {
      const stream = await docker.streamLogs(containerId);
      activeLogStream = stream;
      const handler = (data) => {
        socket.emit('logs:data', {
          containerId,
          line: data.toString('utf8').replace(/[\x00-\x08]/g, '')
        });
      };
      stream.on('data', handler);
      socket.on('logs:unsubscribe', () => { stream.destroy(); activeLogStream = null; });
      socket.on('disconnect', () => { stream.destroy(); activeLogStream = null; });
    } catch (err) {
      socket.emit('logs:error', { containerId, error: 'Failed to stream logs.' });
    }
  });

  // Status polling
  let statusInterval = null;
  socket.on('status:subscribe', () => {
    if (statusInterval) clearInterval(statusInterval);
    const sendStatus = async () => {
      try {
        const containers = await docker.listContainers();
        socket.emit('status:update', containers);
      } catch (err) {
        socket.emit('status:error', 'Failed to fetch status.');
      }
    };
    sendStatus();
    statusInterval = setInterval(sendStatus, 5000);
  });

  // Host stats polling (CPU/RAM/disk gauges)
  let hostStatsInterval = null;
  socket.on('hoststats:subscribe', () => {
    if (hostStatsInterval) clearInterval(hostStatsInterval);
    const sendHostStats = async () => {
      try {
        const stats = await docker.getHostStats();
        socket.emit('hoststats:update', stats);
      } catch {}
    };
    sendHostStats();
    hostStatsInterval = setInterval(sendHostStats, 3000);
  });

  socket.on('disconnect', () => {
    if (statusInterval) clearInterval(statusInterval);
    if (hostStatsInterval) clearInterval(hostStatsInterval);
    if (activeLogStream) { activeLogStream.destroy(); activeLogStream = null; }
  });
});

// --- SPA Fallback ---

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---

server.listen(PORT, '0.0.0.0', () => {
  log('INFO', `SparkBox Dashboard running on port ${PORT}`);
  log('INFO', `SB_ROOT: ${SB_ROOT}`);
  log('INFO', `Backup encryption: ${process.env.SB_BACKUP_KEY ? 'dedicated key' : process.env.SB_SESSION_SECRET ? 'session secret' : 'disabled'}`);
});

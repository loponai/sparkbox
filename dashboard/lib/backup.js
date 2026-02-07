const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Get the backup encryption secret (dedicated key preferred, session secret as fallback)
function getBackupSecret() {
  return process.env.SB_BACKUP_KEY || process.env.SB_SESSION_SECRET;
}

// Derive encryption key from the backup secret
function deriveKey(secret) {
  return crypto.scryptSync(secret, 'sparkbox-backup-salt', KEY_LENGTH);
}

async function create(sbRoot, encrypt = true) {
  const backupDir = path.join(sbRoot, 'backups');
  await fs.mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const tarFilename = `sparkbox-backup-${timestamp}.tar.gz`;
  const tarPath = path.join(backupDir, tarFilename);

  execSync(
    `tar -czf "${tarPath}" -C "${sbRoot}" state .env modules/*/config 2>/dev/null || true`,
    { timeout: 300000 }
  );

  // Encrypt the backup if an encryption key is available
  const secret = getBackupSecret();
  if (encrypt && secret) {
    const encFilename = `sparkbox-backup-${timestamp}.tar.gz.enc`;
    const encPath = path.join(backupDir, encFilename);

    const key = deriveKey(secret);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const plaintext = await fs.readFile(tarPath);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // File format: [16 bytes IV][16 bytes auth tag][encrypted data]
    await fs.writeFile(encPath, Buffer.concat([iv, authTag, encrypted]));

    // Remove unencrypted tar
    await fs.unlink(tarPath);

    const stat = await fs.stat(encPath);
    return {
      filename: encFilename,
      path: encPath,
      size: stat.size,
      created: stat.birthtime,
      encrypted: true
    };
  }

  const stat = await fs.stat(tarPath);
  return {
    filename: tarFilename,
    path: tarPath,
    size: stat.size,
    created: stat.birthtime,
    encrypted: false
  };
}

async function list(sbRoot) {
  const backupDir = path.join(sbRoot, 'backups');
  try {
    const files = await fs.readdir(backupDir);
    const backups = [];
    for (const file of files) {
      if (!file.startsWith('sparkbox-backup-')) continue;
      if (!file.endsWith('.tar.gz') && !file.endsWith('.tar.gz.enc')) continue;
      const filePath = path.join(backupDir, file);
      const stat = await fs.stat(filePath);
      backups.push({
        filename: file,
        size: stat.size,
        created: stat.mtime,
        encrypted: file.endsWith('.enc')
      });
    }
    return backups.sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

async function getPath(sbRoot, filename) {
  // Sanitize filename to prevent path traversal
  const sanitized = path.basename(filename);
  if (!sanitized.startsWith('sparkbox-backup-')) {
    throw new Error('Invalid backup filename');
  }
  if (!sanitized.endsWith('.tar.gz') && !sanitized.endsWith('.tar.gz.enc')) {
    throw new Error('Invalid backup filename');
  }
  const filePath = path.join(sbRoot, 'backups', sanitized);
  await fs.access(filePath);
  return filePath;
}

// Decrypt a backup for download (returns path to temp decrypted file)
async function decrypt(sbRoot, filename) {
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('.tar.gz.enc')) {
    throw new Error('File is not encrypted');
  }

  const secret = getBackupSecret();
  if (!secret) throw new Error('No decryption key available');

  const encPath = path.join(sbRoot, 'backups', sanitized);
  await fs.access(encPath);

  const data = await fs.readFile(encPath);
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // Write to temp file
  const tmpPath = path.join(sbRoot, 'backups', sanitized.replace('.enc', ''));
  await fs.writeFile(tmpPath, decrypted);

  // Schedule cleanup after 60 seconds
  setTimeout(async () => {
    try { await fs.unlink(tmpPath); } catch {}
  }, 60000);

  return tmpPath;
}

module.exports = { create, list, getPath, decrypt };

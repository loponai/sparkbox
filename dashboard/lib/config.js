const fs = require('fs').promises;
const path = require('path');

// Read .env file into key-value object
async function read(sbRoot) {
  const envPath = path.join(sbRoot, '.env');
  try {
    const content = await fs.readFile(envPath, 'utf8');
    const config = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex);
      const value = trimmed.substring(eqIndex + 1);
      config[key] = value;
    }
    return config;
  } catch {
    return {};
  }
}

// Update specific keys in .env file
async function update(sbRoot, updates) {
  const envPath = path.join(sbRoot, '.env');
  let content;

  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const updatedKeys = new Set();

  // Update existing keys
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return line;

    const key = trimmed.substring(0, eqIndex);
    if (key in updates) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Add new keys
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  await fs.writeFile(envPath, newLines.join('\n'));
}

module.exports = { read, update };

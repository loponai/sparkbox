const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');

const CORE_MODULES = ['core', 'dashboard'];

const MODULE_INFO = {
  core: {
    name: 'Core Infrastructure',
    description: 'The essential foundation: a reverse proxy to route your domain to the right service, a container manager for troubleshooting, and a start page to find everything.',
    services: ['sb-npm', 'sb-portainer', 'sb-homepage'],
    required: true,
    icon: 'server',
    ram: '~300MB'
  },
  dashboard: {
    name: 'SparkBox Dashboard',
    description: 'The web interface you use to manage your server — toggle modules, view logs, and change settings.',
    services: ['sb-dashboard'],
    required: true,
    icon: 'layout-dashboard',
    ram: '~80MB'
  },
  privacy: {
    name: 'Privacy & Security',
    description: 'Block ads and trackers (Pi-hole), store passwords securely (Vaultwarden), and add login protection with two-factor auth (Authelia).',
    services: ['sb-pihole', 'sb-vaultwarden', 'sb-authelia'],
    required: false,
    icon: 'shield',
    ram: '~250MB'
  },
  cloud: {
    name: 'Cloud Storage',
    description: 'Your own private Google Drive. Sync files between phone, laptop, and server. Share files with links. Includes calendar and contacts too.',
    services: ['sb-nextcloud', 'sb-nextcloud-db', 'sb-nextcloud-redis'],
    required: false,
    icon: 'cloud',
    ram: '~500MB'
  },
  monitoring: {
    name: 'Monitoring',
    description: 'Keeps an eye on all your services and alerts you if anything goes down. Sends notifications to Telegram, Discord, email, and more.',
    services: ['sb-uptime-kuma'],
    required: false,
    icon: 'activity',
    ram: '~80MB'
  },
  vpn: {
    name: 'Remote Access VPN',
    description: 'Connect securely to your server from anywhere using WireGuard. Access all your services as if you were sitting right next to your server.',
    services: ['sb-wg-easy'],
    required: false,
    icon: 'lock',
    ram: '~30MB'
  },
  files: {
    name: 'File Browser',
    description: 'A web-based file manager for your server. Browse, upload, download, and organize files without needing SSH or FTP.',
    services: ['sb-filebrowser'],
    required: false,
    icon: 'folder',
    ram: '~30MB'
  }
};

async function getEnabledModules(sbRoot) {
  const confPath = path.join(sbRoot, 'state', 'modules.conf');
  try {
    const content = await fs.readFile(confPath, 'utf8');
    return content.trim().split('\n').filter(Boolean);
  } catch {
    return CORE_MODULES;
  }
}

async function list(sbRoot) {
  const enabled = await getEnabledModules(sbRoot);

  return Object.entries(MODULE_INFO).map(([key, info]) => ({
    id: key,
    ...info,
    enabled: enabled.includes(key),
    hasCompose: true
  }));
}

// Read x-sparkbox metadata from a module's docker-compose.yml
async function readComposeMetadata(sbRoot, moduleId) {
  const composePath = path.join(sbRoot, 'modules', moduleId, 'docker-compose.yml');
  try {
    const content = await fs.readFile(composePath, 'utf8');
    const doc = yaml.load(content);
    return doc['x-sparkbox'] || null;
  } catch {
    return null;
  }
}

// Normalize tips to an array of strings (handles both array and key-value map formats)
function normalizeTips(tips) {
  if (!tips) return [];
  if (Array.isArray(tips)) return tips;
  if (typeof tips === 'object') return Object.values(tips);
  return [String(tips)];
}

// List modules with rich x-sparkbox metadata merged in
async function listRich(sbRoot) {
  const enabled = await getEnabledModules(sbRoot);
  const moduleDirs = await getAvailableModuleDirs(sbRoot);

  const results = [];
  for (const moduleId of moduleDirs) {
    const meta = await readComposeMetadata(sbRoot, moduleId);
    const fallback = MODULE_INFO[moduleId];

    if (meta) {
      results.push({
        id: moduleId,
        name: meta.title || (fallback && fallback.name) || moduleId,
        tagline: meta.tagline || '',
        description: meta.description || (fallback && fallback.description) || '',
        icon: meta.icon || (fallback && fallback.icon) || 'package',
        category: meta.category || 'other',
        required: meta.required === true || CORE_MODULES.includes(moduleId),
        ram: meta.ram || (fallback && fallback.ram) || '?',
        tips: normalizeTips(meta.tips),
        services: meta.services ? Object.entries(meta.services).map(([key, svc]) => ({
          id: key,
          name: svc.friendly_name || key,
          description: svc.description || '',
          port: svc.port_map || null,
          tip: svc.tip || ''
        })) : (fallback && fallback.services || []).map(s => ({ id: s, name: s })),
        enabled: enabled.includes(moduleId),
        hasCompose: true
      });
    } else if (fallback) {
      results.push({
        id: moduleId,
        name: fallback.name,
        tagline: '',
        description: fallback.description,
        icon: fallback.icon,
        category: 'other',
        required: fallback.required || CORE_MODULES.includes(moduleId),
        ram: fallback.ram,
        tips: [],
        services: fallback.services.map(s => ({ id: s, name: s })),
        enabled: enabled.includes(moduleId),
        hasCompose: true
      });
    }
  }

  return results;
}

// Discover all module directories (folders with docker-compose.yml)
async function getAvailableModuleDirs(sbRoot) {
  const modulesDir = path.join(sbRoot, 'modules');
  try {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const composePath = path.join(modulesDir, entry.name, 'docker-compose.yml');
        try {
          await fs.access(composePath);
          dirs.push(entry.name);
        } catch {
          // No compose file, skip
        }
      }
    }
    return dirs;
  } catch {
    return Object.keys(MODULE_INFO);
  }
}

async function enable(sbRoot, moduleName) {
  if (!MODULE_INFO[moduleName]) {
    throw new Error(`Unknown module: ${moduleName}`);
  }
  if (CORE_MODULES.includes(moduleName)) {
    throw new Error(`${moduleName} is a core module and cannot be toggled`);
  }

  const enabled = await getEnabledModules(sbRoot);
  if (enabled.includes(moduleName)) {
    return; // Already enabled
  }

  enabled.push(moduleName);
  const confPath = path.join(sbRoot, 'state', 'modules.conf');
  await fs.writeFile(confPath, enabled.join('\n') + '\n');

  // Start the module
  await runSparkboxCommand(sbRoot, ['up']);
}

async function disable(sbRoot, moduleName) {
  if (CORE_MODULES.includes(moduleName)) {
    throw new Error(`Cannot disable core module: ${moduleName}`);
  }

  const enabled = await getEnabledModules(sbRoot);
  const filtered = enabled.filter(m => m !== moduleName);

  const confPath = path.join(sbRoot, 'state', 'modules.conf');
  await fs.writeFile(confPath, filtered.join('\n') + '\n');

  // Stop the module containers
  const info = MODULE_INFO[moduleName];
  if (info) {
    for (const service of info.services) {
      try {
        const Docker = require('dockerode');
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        const container = docker.getContainer(service);
        await container.stop();
        await container.remove();
      } catch {
        // Container may not exist
      }
    }
  }
}

function runSparkboxCommand(sbRoot, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [path.join(sbRoot, 'sparkbox'), ...args], {
      cwd: sbRoot,
      env: { ...process.env, SB_ROOT: sbRoot }
    });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output));
    });
  });
}

module.exports = { list, listRich, enable, disable, getEnabledModules, MODULE_INFO };

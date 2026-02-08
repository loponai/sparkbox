const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');

const CORE_MODULES = ['core', 'dashboard'];

async function getEnabledModules(sbRoot) {
  const confPath = path.join(sbRoot, 'state', 'modules.conf');
  try {
    const content = await fs.readFile(confPath, 'utf8');
    return content.trim().split('\n').filter(Boolean);
  } catch {
    return CORE_MODULES;
  }
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

// Read container names from a module's docker-compose.yml services section
async function readComposeServices(sbRoot, moduleId) {
  const composePath = path.join(sbRoot, 'modules', moduleId, 'docker-compose.yml');
  try {
    const content = await fs.readFile(composePath, 'utf8');
    const doc = yaml.load(content);
    const services = doc.services || {};
    return Object.values(services)
      .map(svc => svc.container_name)
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Normalize tips to an array of strings (handles both array and key-value map formats)
function normalizeTips(tips) {
  if (!tips) return [];
  if (Array.isArray(tips)) return tips;
  if (typeof tips === 'object') return Object.values(tips);
  return [String(tips)];
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
    return [];
  }
}

async function list(sbRoot) {
  const enabled = await getEnabledModules(sbRoot);
  const moduleDirs = await getAvailableModuleDirs(sbRoot);

  const results = [];
  for (const moduleId of moduleDirs) {
    const meta = await readComposeMetadata(sbRoot, moduleId);
    if (!meta) continue;

    results.push({
      id: moduleId,
      name: meta.title || moduleId,
      description: meta.description || '',
      required: meta.required === true || CORE_MODULES.includes(moduleId),
      icon: meta.icon || 'package',
      ram: meta.ram || '?',
      enabled: enabled.includes(moduleId),
      hasCompose: true
    });
  }
  return results;
}

// List modules with rich x-sparkbox metadata merged in
async function listRich(sbRoot) {
  const enabled = await getEnabledModules(sbRoot);
  const moduleDirs = await getAvailableModuleDirs(sbRoot);

  const results = [];
  for (const moduleId of moduleDirs) {
    const meta = await readComposeMetadata(sbRoot, moduleId);
    if (!meta) continue;

    results.push({
      id: moduleId,
      name: meta.title || moduleId,
      tagline: meta.tagline || '',
      description: meta.description || '',
      icon: meta.icon || 'package',
      category: meta.category || 'other',
      required: meta.required === true || CORE_MODULES.includes(moduleId),
      default: meta.default === true,
      ram: meta.ram || '?',
      tips: normalizeTips(meta.tips),
      theme: meta.theme || null,
      env_vars: meta.env_vars || null,
      critical_services: meta.critical_services || [],
      services: meta.services ? Object.entries(meta.services).map(([key, svc]) => ({
        id: key,
        name: svc.friendly_name || key,
        description: svc.description || '',
        port: svc.port_map || null,
        https: svc.https || false,
        tip: svc.tip || ''
      })) : [],
      enabled: enabled.includes(moduleId),
      hasCompose: true
    });
  }

  return results;
}

async function enable(sbRoot, moduleName) {
  // Validate module exists on filesystem
  const available = await getAvailableModuleDirs(sbRoot);
  if (!available.includes(moduleName)) {
    throw new Error(`Unknown module: ${moduleName}`);
  }

  const meta = await readComposeMetadata(sbRoot, moduleName);
  if (meta && meta.required === true || CORE_MODULES.includes(moduleName)) {
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

  // Stop the module containers by reading container names from compose
  const containerNames = await readComposeServices(sbRoot, moduleName);
  for (const containerName of containerNames) {
    try {
      const Docker = require('dockerode');
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(containerName);
      await container.stop();
      await container.remove();
    } catch {
      // Container may not exist
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

module.exports = { list, listRich, enable, disable, getEnabledModules, getAvailableModuleDirs, readComposeMetadata };

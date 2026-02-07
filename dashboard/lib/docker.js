const Docker = require('dockerode');
const { execSync, spawn } = require('child_process');
const fs = require('fs');

// Check if Docker socket exists
const DOCKER_AVAILABLE = fs.existsSync('/var/run/docker.sock');
const docker = DOCKER_AVAILABLE ? new Docker({ socketPath: '/var/run/docker.sock' }) : null;

// Mock data for demo/dev mode when Docker is unavailable
const MOCK_CONTAINERS = [
  { id: 'mock-npm-001', name: 'sb-npm', image: 'jc21/nginx-proxy-manager:latest', state: 'running', status: 'Up 2 hours', ports: [{ private: 80, public: 80, type: 'tcp' }, { private: 81, public: 81, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-port-002', name: 'sb-portainer', image: 'portainer/portainer-ce:latest', state: 'running', status: 'Up 2 hours', ports: [{ private: 9000, public: 9000, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-home-003', name: 'sb-homepage', image: 'ghcr.io/gethomepage/homepage:latest', state: 'running', status: 'Up 2 hours', ports: [{ private: 3000, public: 3000, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-dash-004', name: 'sb-dashboard', image: 'sparkbox/dashboard:latest', state: 'running', status: 'Up 2 hours', ports: [{ private: 8443, public: 8443, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-piho-005', name: 'sb-pihole', image: 'pihole/pihole:latest', state: 'running', status: 'Up 1 hour', ports: [{ private: 53, public: 53, type: 'tcp' }, { private: 80, public: 8053, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-vaul-006', name: 'sb-vaultwarden', image: 'vaultwarden/server:latest', state: 'running', status: 'Up 1 hour', ports: [{ private: 80, public: 8222, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-auth-007', name: 'sb-authelia', image: 'authelia/authelia:latest', state: 'running', status: 'Up 1 hour', ports: [{ private: 9091, public: 9091, type: 'tcp' }], created: Date.now() / 1000 },
  { id: 'mock-ukum-014', name: 'sb-uptime-kuma', image: 'louislam/uptime-kuma:latest', state: 'exited', status: 'Exited (0) 10 min ago', ports: [], created: Date.now() / 1000 },
];

// List all SparkBox containers (prefixed with sb-)
async function listContainers() {
  if (!docker) return MOCK_CONTAINERS;
  const containers = await docker.listContainers({ all: true });
  return containers
    .filter(c => c.Names.some(n => n.startsWith('/sb-')))
    .map(c => ({
      id: c.Id.substring(0, 12),
      name: c.Names[0].replace('/', ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports.map(p => ({
        private: p.PrivatePort,
        public: p.PublicPort,
        type: p.Type
      })).filter(p => p.public),
      created: c.Created
    }));
}

// Get container resource stats
async function getContainerStats(containerId) {
  if (!docker) {
    return {
      cpu: Math.round(Math.random() * 15 * 100) / 100,
      memory: {
        usage: Math.floor(Math.random() * 500 * 1024 * 1024),
        limit: 8 * 1024 * 1024 * 1024,
        percent: Math.round(Math.random() * 8 * 100) / 100
      },
      network: {}
    };
  }
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });

  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 1;
  const memPercent = (memUsage / memLimit) * 100;

  return {
    cpu: Math.round(cpuPercent * 100) / 100,
    memory: {
      usage: memUsage,
      limit: memLimit,
      percent: Math.round(memPercent * 100) / 100
    },
    network: stats.networks || {}
  };
}

// Validate that a container belongs to SparkBox (sb- prefix)
async function validateSparkBoxContainer(containerId) {
  if (!docker) {
    return MOCK_CONTAINERS.some(c => c.id === containerId || c.name === containerId);
  }
  const containers = await docker.listContainers({ all: true });
  return containers.some(c =>
    (c.Id.startsWith(containerId) || c.Names.some(n => n.replace('/', '') === containerId)) &&
    c.Names.some(n => n.startsWith('/sb-'))
  );
}

// Restart a container
async function restartContainer(containerId) {
  if (!docker) return;
  if (!(await validateSparkBoxContainer(containerId))) throw new Error('Container not found');
  const container = docker.getContainer(containerId);
  await container.restart();
}

// Stop a container
async function stopContainer(containerId) {
  if (!docker) return;
  if (!(await validateSparkBoxContainer(containerId))) throw new Error('Container not found');
  const container = docker.getContainer(containerId);
  await container.stop();
}

// Start a container
async function startContainer(containerId) {
  if (!docker) return;
  if (!(await validateSparkBoxContainer(containerId))) throw new Error('Container not found');
  const container = docker.getContainer(containerId);
  await container.start();
}

// Stream logs from a container
async function streamLogs(containerId) {
  if (!docker) {
    // Return a mock stream for demo mode
    const { Readable } = require('stream');
    const stream = new Readable({ read() {} });
    const lines = [
      '2026-02-06T17:00:00Z [INFO] SparkBox demo mode - no Docker socket\n',
      '2026-02-06T17:00:01Z [INFO] Container logs would appear here in production\n',
      '2026-02-06T17:00:02Z [INFO] Connect Docker Desktop WSL integration to see real containers\n',
    ];
    let i = 0;
    const iv = setInterval(() => {
      if (i < lines.length) { stream.push(lines[i++]); }
      else { stream.push(`2026-02-06T17:00:${String(i++).padStart(2,'0')}Z [INFO] Heartbeat - system running normally\n`); }
      if (i > 20) { clearInterval(iv); stream.push(null); }
    }, 1000);
    stream.on('close', () => clearInterval(iv));
    return stream;
  }
  const container = docker.getContainer(containerId);
  const stream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 200,
    timestamps: true
  });
  return stream;
}

// Pull latest images and recreate (uses sparkbox CLI)
async function pullAndRecreate(sbRoot) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', `${sbRoot}/sparkbox update`], {
      cwd: sbRoot,
      env: { ...process.env, SB_ROOT: sbRoot }
    });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Update failed (exit ${code}): ${output}`));
    });
  });
}

// Get system info
async function getSystemInfo() {
  if (!docker) {
    const os = require('os');
    return {
      containers: MOCK_CONTAINERS.length,
      containersRunning: MOCK_CONTAINERS.filter(c => c.state === 'running').length,
      containersStopped: MOCK_CONTAINERS.filter(c => c.state !== 'running').length,
      images: 14,
      dockerVersion: 'Demo Mode',
      os: os.type() + ' ' + os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: os.totalmem(),
      hostname: os.hostname()
    };
  }
  const info = await docker.info();
  return {
    containers: info.Containers,
    containersRunning: info.ContainersRunning,
    containersStopped: info.ContainersStopped,
    images: info.Images,
    dockerVersion: info.ServerVersion,
    os: info.OperatingSystem,
    arch: info.Architecture,
    cpus: info.NCPU,
    memory: info.MemTotal,
    hostname: info.Name
  };
}

// Get live host stats (CPU, RAM, disk) for dashboard gauges
async function getHostStats() {
  const os = require('os');

  // CPU usage: compare idle time across a 500ms window
  const cpus1 = os.cpus();
  const idle1 = cpus1.reduce((sum, c) => sum + c.times.idle, 0);
  const total1 = cpus1.reduce((sum, c) => sum + Object.values(c.times).reduce((a, b) => a + b, 0), 0);

  await new Promise(r => setTimeout(r, 200));

  const cpus2 = os.cpus();
  const idle2 = cpus2.reduce((sum, c) => sum + c.times.idle, 0);
  const total2 = cpus2.reduce((sum, c) => sum + Object.values(c.times).reduce((a, b) => a + b, 0), 0);

  const idleDelta = idle2 - idle1;
  const totalDelta = total2 - total1;
  const cpuPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : 0;

  // RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = Math.round((usedMem / totalMem) * 1000) / 10;

  // Disk usage (root partition)
  let diskTotal = 0, diskUsed = 0, diskPercent = 0;
  try {
    const df = execSync("df -B1 / | awk 'NR==2 {print $2,$3,$5}'", { timeout: 5000 }).toString().trim().split(' ');
    diskTotal = parseInt(df[0]) || 0;
    diskUsed = parseInt(df[1]) || 0;
    diskPercent = parseFloat(df[2]) || 0;
  } catch {
    // Fallback if df fails
  }

  // Uptime
  const uptimeSeconds = os.uptime();

  return {
    cpu: { percent: cpuPercent, cores: cpus2.length },
    memory: { total: totalMem, used: usedMem, percent: memPercent },
    disk: { total: diskTotal, used: diskUsed, percent: diskPercent },
    uptime: uptimeSeconds
  };
}

module.exports = {
  listContainers,
  getContainerStats,
  restartContainer,
  stopContainer,
  startContainer,
  streamLogs,
  pullAndRecreate,
  getSystemInfo,
  getHostStats
};

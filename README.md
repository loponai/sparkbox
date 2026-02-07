# SparkBox

**Your complete self-hosted privacy server in one command.**

Created by **Tom Spark** | [youtube.com/@TomSparkReviews](https://youtube.com/@TomSparkReviews)

---

## What is SparkBox?

SparkBox turns a basic VPS into a full privacy powerhouse. It bundles ad-blocking, password management, cloud storage, VPN access, file management, and server monitoring into one easy-to-manage system — all controlled from a web dashboard.

Think of it like building your own private version of Google Drive + a password manager + an ad-blocker, running on a server YOU own. No subscriptions to big tech. No one mining your data.

**No experience needed.** If you can copy-paste one command, you can run SparkBox.

---

## What You Get

| Module | What It Does | Services Included | RAM |
|--------|-------------|-------------------|-----|
| **Core** | The foundation — routes domains, manages containers, gives you a start page | Nginx Proxy Manager, Portainer, Homepage | ~300MB |
| **Dashboard** | Web UI to manage everything from your browser | SparkBox Dashboard | ~80MB |
| **Privacy** | Blocks ads network-wide, stores passwords, protects logins with 2FA | Pi-hole, Vaultwarden, Authelia | ~250MB |
| **Cloud** | Your private Google Drive — sync files across all devices | Nextcloud, MariaDB, Redis | ~500MB |
| **Monitoring** | Watches your services 24/7 and pings you if something dies | Uptime Kuma | ~80MB |
| **VPN Access** | Connect to your server securely from anywhere in the world | WireGuard (wg-easy) | ~30MB |
| **File Browser** | Browse, upload, and download files on your server from the browser | FileBrowser | ~30MB |

**Total with everything enabled: ~1.3GB idle** — fits easily on a 4GB VPS with room to spare.

---

## What You Need

- A **VPS** (Virtual Private Server) running **Ubuntu 22.04+** or **Debian 12+**
  - Minimum: 4GB RAM / 2 vCPU
  - Recommended: **8GB RAM / 4 vCPU** (for all modules)
- **Root or sudo access** to your server
- An **SSH client** to connect to your server (Terminal on Mac/Linux, [PuTTY](https://putty.org) or Windows Terminal on Windows)
- A **domain name** (optional but strongly recommended for SSL/HTTPS)

### Recommended VPS

[**ScalaHosting**](https://scalahosting.tomspark.tech) — Their 8GB RAM / 4 vCPU plans are perfect for SparkBox with all modules. Use Tom's link for the best deal.

---

## Installation (Step by Step)

### Step 1: Get Your Server Ready

SSH into your VPS:

```bash
ssh root@your-server-ip
```

Make sure your system is updated:

```bash
apt update && apt upgrade -y
```

### Step 2: Run the Installer

Copy and paste this single command:

```bash
curl -sSL https://get.sparkbox.app/install.sh | sudo bash
```

This automatically:
1. Installs Docker and all required system packages
2. Downloads SparkBox to `/opt/sparkbox`
3. Sets up your firewall (opens only the ports you need)
4. Launches the setup wizard

### Step 3: Setup Wizard

The wizard walks you through everything with a simple menu interface:

1. **Choose your modules** — Check the boxes for features you want (Privacy, Cloud, etc.)
2. **Set your timezone** — e.g., `America/New_York`
3. **Enter your domain** — e.g., `myserver.example.com` (or leave as your IP)
4. **Dashboard password** — Create a password for your web dashboard

The wizard generates all security keys automatically. You don't need to touch them.

### Step 4: Wait for Deployment

SparkBox pulls all the Docker images and starts your services. This takes 2-5 minutes depending on your internet speed.

When it's done, you'll see:

```
[OK] SparkBox is running!

Service URLs:
  Core:
    NPM Admin:     http://your-server:81
    Portainer:      http://your-server:9000
    Homepage:       http://your-server:3000
    Dashboard:      http://your-server:8443
  ...
```

### Step 5: Open Your Dashboard

Open your browser and go to:

```
http://your-server-ip:8443
```

Log in with the password you set during installation. You're in!

### Alternative: Manual Install

If you prefer to do it manually:

```bash
git clone https://github.com/tomsparkreview/sparkbox /opt/sparkbox
cd /opt/sparkbox
chmod +x sparkbox
sudo ./sparkbox install
```

---

## Using the Dashboard

The web dashboard is your control center. Here's what each tab does:

### Home

- **System gauges** — Live CPU, RAM, disk usage, and server uptime at a glance
- **Service cards** — Click any card to open that service's web UI
- **Running list** — See every container's status, CPU, and memory usage
- **Quick actions** — Restart or stop any service with one click

### Apps (App Store)

- Browse all available modules with descriptions and service lists
- **Filter by category** — Privacy, System, Tools, etc.
- **Toggle modules on/off** — Flip a switch to enable or disable entire feature groups
- Each card shows RAM usage, included services, and tips

### Logs

- Pick any service from the dropdown to see its live log output
- Logs stream in real-time via WebSocket
- Look for red "error" lines when troubleshooting

### Settings

- **General** — Change your timezone, domain, etc.
- **Privacy / Cloud** — Security keys (auto-generated, don't change unless you know what you're doing)
- **Backups** — Create a backup, download previous backups

### Help

- Plain-English explanation of every service
- FAQ for common questions
- Tips for first-time self-hosters

---

## CLI Reference

SparkBox also has a command-line tool. SSH into your server and run:

```
sparkbox help
```

### Most Common Commands

```bash
# See what's running
sparkbox status

# Start everything
sparkbox up

# Stop everything
sparkbox down

# Enable a new module
sparkbox enable cloud

# Disable a module
sparkbox disable cloud

# Restart a module
sparkbox restart privacy

# Update all containers to latest versions
sparkbox update

# See live logs for a service
sparkbox logs sb-pihole

# Create a backup
sparkbox backup

# Show all service URLs
sparkbox urls
```

### Available Modules

```
core         Nginx Proxy Manager + Portainer + Homepage (always on)
dashboard    SparkBox Web Dashboard (always on)
privacy      Pi-hole + Vaultwarden + Authelia
cloud        Nextcloud + MariaDB + Redis
monitoring   Uptime Kuma
vpn          WireGuard (wg-easy)
files        FileBrowser (web-based file manager)
```

---

## Setting Up a Domain (Recommended)

Having a domain lets you access services via URLs like `vault.yourdomain.com` instead of `your-ip:8222`.

### Step 1: Point Your Domain

In your domain registrar (Namecheap, Cloudflare, etc.), create an **A record**:

```
Type: A
Name: * (wildcard) or specific subdomains
Value: your-server-ip
TTL: Auto
```

### Step 2: Configure Nginx Proxy Manager

1. Open NPM at `http://your-server:81`
2. Default login: `admin@example.com` / `changeme`
3. Click **Proxy Hosts** > **Add Proxy Host**
4. For each service:
   - **Domain**: `vault.yourdomain.com`
   - **Forward Hostname**: `sb-vaultwarden` (the container name)
   - **Forward Port**: `80` (the service port)
   - Enable **SSL** with Let's Encrypt (free!)
5. Repeat for each service you want on a subdomain

### Suggested Subdomains

| Service | Subdomain | Internal Port |
|---------|-----------|---------------|
| Vaultwarden | `vault.yourdomain.com` | 80 |
| Nextcloud | `cloud.yourdomain.com` | 443 |
| Pi-hole | `pihole.yourdomain.com` | 80 |
| Dashboard | `dash.yourdomain.com` | 8443 |
| Uptime Kuma | `status.yourdomain.com` | 3001 |
| WireGuard | `vpn.yourdomain.com` | 51821 |

---

## Setting Up Remote Access (WireGuard VPN)

WireGuard lets you securely access ALL your services from your phone or laptop, anywhere in the world.

### Step 1: Enable the VPN Module

```bash
sparkbox enable vpn
sparkbox up
```

Or toggle it on from the Apps page in the dashboard.

### Step 2: Create a Client

1. Open wg-easy at `http://your-server:51821`
2. Click **New Client**
3. Give it a name (e.g., "My Phone")
4. Click the **QR code** icon

### Step 3: Connect

1. Install the **WireGuard** app on your phone ([iOS](https://apps.apple.com/app/wireguard/id1441195209) / [Android](https://play.google.com/store/apps/details?id=com.wireguard.android))
2. Tap **Add Tunnel** > **Scan QR Code**
3. Scan the QR code from wg-easy
4. Connect!

Now you can access `http://your-server-ip:8443` (Dashboard), `http://your-server-ip:8222` (Vaultwarden), etc., from anywhere as if you were on the same network.

---

## Backups

### From the Dashboard

1. Go to **Settings** > **Backups**
2. Click **Create Backup Now**
3. Download the backup file

### From the CLI

```bash
# Create a backup
sparkbox backup

# Restore from a backup
sparkbox restore /opt/sparkbox/backups/sparkbox-backup-20260206_120000.tar.gz
```

Backups include your configuration, module settings, and service data. Backups are automatically encrypted when `SB_BACKUP_KEY` is set (done automatically during installation).

---

## Updating

### Update All Services

```bash
sparkbox update
```

This pulls the latest Docker images and recreates all containers. Your data and configuration are preserved.

### Update a Specific Module

```bash
sparkbox update privacy
```

---

## Troubleshooting

### A service won't start

1. Check its logs: `sparkbox logs sb-servicename` (e.g., `sparkbox logs sb-pihole`)
2. Look for lines containing "error" or "failed"
3. Try restarting it: click **Restart** in the dashboard or run `docker restart sb-servicename`

### I forgot my dashboard password

```bash
# Clear the password hash
nano /opt/sparkbox/.env
# Find SB_ADMIN_PASSWORD_HASH= and delete the value (leave it blank)
# Save and exit (Ctrl+X, Y, Enter)

# Restart the dashboard
sparkbox restart dashboard
```

You'll be asked to set a new password on your next login.

### Pi-hole isn't blocking ads

1. Make sure the Privacy module is enabled
2. Set your device's DNS to your server's IP address
3. Or set your router's DNS to your server's IP (blocks ads for all devices on your network)

### I want to access services from outside my network

You have two options:
1. **Domain + Nginx Proxy Manager** — Set up subdomains with SSL (see [Setting Up a Domain](#setting-up-a-domain-recommended))
2. **WireGuard VPN** — Tunnel into your server securely (see [Setting Up Remote Access](#setting-up-remote-access-wireguard-vpn))

---

## Architecture

```
                    ┌────────────────────────────────────┐
                    │      SparkBox Web Dashboard         │
                    │    (toggle modules, view logs,      │
                    │     manage settings, backups)       │
                    │              :8443                   │
                    └──────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │      Nginx Proxy Manager           │
                    │      :80 / :443 / :81              │
                    │   (routes domains to services)     │
                    └──────────────┬────────────────────┘
                                   │
  ┌───────────┬───────────┬───────┴────┬───────────┬──────────┐
  │ Privacy   │ Cloud     │ Monitor    │ VPN       │ Files    │
  │           │           │            │           │          │
  │ Pi-hole   │ Nextcloud │ Uptime     │ WireGuard │ File     │
  │ Vault     │ MariaDB   │ Kuma       │ (wg-easy) │ Browser  │
  │ Authelia  │ Redis     │            │           │          │
  └───────────┴───────────┴────────────┴───────────┴──────────┘
```

Each module runs on its own isolated Docker network. All web-accessible services share a `sb_proxy` network so Nginx Proxy Manager can route traffic to them.

---

## Security

SparkBox is built with security in mind:

- **Authelia** adds login pages and 2FA in front of admin services
- **All ports are localhost-only** (except 80, 443, and WireGuard) — services are only accessible through the reverse proxy or VPN
- **Auto-generated secrets** — all passwords, tokens, and encryption keys are created with `openssl rand` during setup
- **Encrypted backups** — backups are AES-256-GCM encrypted with a dedicated key
- **UFW firewall** — the installer automatically configures your firewall
- **No-new-privileges** — containers cannot escalate their permissions
- **Resource limits** — every container has CPU and memory caps to prevent runaway processes

---

## Directory Structure

```
/opt/sparkbox/
├── sparkbox                    # CLI tool (symlinked to /usr/local/bin)
├── .env                        # Your configuration (auto-generated secrets)
├── state/
│   └── modules.conf            # Which modules are enabled
├── modules/
│   ├── core/                   # Nginx Proxy Manager + Portainer + Homepage
│   ├── dashboard/              # SparkBox Web Dashboard
│   ├── privacy/                # Pi-hole + Vaultwarden + Authelia
│   ├── cloud/                  # Nextcloud + MariaDB + Redis
│   ├── monitoring/             # Uptime Kuma
│   ├── vpn/                    # WireGuard
│   └── files/                  # FileBrowser
├── scripts/                    # Install and setup scripts
├── dashboard/                  # Dashboard web app source
└── backups/                    # Encrypted backup archives
```

---

## FAQ

**Q: How much does this cost?**
A: SparkBox itself is free and open source. You only pay for the VPS (~$10-30/month) and optionally a domain (~$10/year).

**Q: Can I add my own services?**
A: Yes! Create a new folder under `modules/` with a `docker-compose.yml` file. Add `x-sparkbox` metadata to make it appear in the App Store with a description and icon.

**Q: Is this safe to run on the internet?**
A: Yes. All admin services are behind localhost-only ports and protected by Authelia 2FA. Only the reverse proxy (ports 80/443) and WireGuard (port 51820) are publicly exposed.

**Q: Can I use this on a Raspberry Pi?**
A: SparkBox targets x86 VPS servers. Some services may work on ARM but it's not officially supported.

**Q: How do I uninstall?**
A: `sparkbox down && rm -rf /opt/sparkbox`. This stops all containers and removes SparkBox. Your Docker installation is left intact.

---

## License

All Rights Reserved — see [LICENSE](LICENSE) for details. No copying, modification, or commercial use without written permission.

---

**SparkBox** — Your server. Your data. Your privacy.

Made with care by [Tom Spark](https://youtube.com/@TomSparkReviews)

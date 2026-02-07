#!/usr/bin/env bash
# ==========================================
# SparkBox - One-Line Installer
# curl -sSL https://get.sparkbox.app/install.sh | bash
#
# Self-Hosted Privacy Stack by Tom Spark
# youtube.com/@TomSparkReviews
# ==========================================

set -euo pipefail

REPO_URL="https://github.com/tomsparkreview/sparkbox"
INSTALL_DIR="/opt/sparkbox"
BRANCH="main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[SparkBox]${NC} $*"; }
log_ok() { echo -e "${GREEN}[SparkBox]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[SparkBox]${NC} $*"; }
log_error() { echo -e "${RED}[SparkBox]${NC} $*"; }

echo ""
echo -e "${CYAN}"
echo "  ____                   _    ____            "
echo " / ___| _ __   __ _ _ __| | _| __ )  _____  __"
echo " \\___ \\| '_ \\ / _\` | '__| |/ /  _ \\ / _ \\ \\/ /"
echo "  ___) | |_) | (_| | |  |   <| |_) | (_) >  < "
echo " |____/| .__/ \\__,_|_|  |_|\\_\\____/ \\___/_/\\_\\"
echo "       |_|                                     "
echo -e "${NC}"
echo -e " ${BOLD}Self-Hosted Privacy Stack Installer${NC}"
echo -e " Created by Tom Spark | youtube.com/@TomSparkReviews"
echo ""

# --- Pre-flight Checks ---

# Must be root or sudo
if [[ $EUID -ne 0 ]]; then
    log_error "This installer must be run as root."
    echo "  Try: sudo bash -c \"\$(curl -sSL https://get.sparkbox.app/install.sh)\""
    exit 1
fi

# Check OS
if [[ ! -f /etc/os-release ]]; then
    log_error "Unsupported operating system."
    exit 1
fi

source /etc/os-release
case "${ID}" in
    ubuntu|debian)
        log_info "Detected: ${PRETTY_NAME}"
        ;;
    *)
        log_warn "Detected: ${PRETTY_NAME} - SparkBox is designed for Ubuntu/Debian."
        log_warn "Continuing anyway, but some features may not work."
        ;;
esac

# Check RAM
total_ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ ${total_ram_mb} -lt 4096 ]]; then
    log_error "Insufficient RAM: ${total_ram_mb}MB detected, minimum 4GB required."
    exit 1
elif [[ ${total_ram_mb} -lt 8192 ]]; then
    log_warn "RAM: ${total_ram_mb}MB detected. 8GB recommended for all modules."
fi

# Check disk space
available_gb=$(df -BG /opt 2>/dev/null | awk 'NR==2 {print int($4)}')
if [[ ${available_gb} -lt 20 ]]; then
    log_warn "Low disk space: ${available_gb}GB available. 20GB+ recommended."
fi

# --- Install Dependencies ---

log_info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git jq openssl whiptail > /dev/null 2>&1
log_ok "System dependencies installed."

# --- Install Docker ---

if command -v docker &>/dev/null; then
    log_ok "Docker already installed: $(docker --version)"
else
    log_info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log_ok "Docker installed: $(docker --version)"
fi

# Verify Docker Compose v2
if docker compose version &>/dev/null; then
    log_ok "Docker Compose: $(docker compose version --short)"
else
    log_error "Docker Compose v2 not found. Please install Docker Compose plugin."
    exit 1
fi

# --- Clone/Download SparkBox ---

if [[ -d "${INSTALL_DIR}/.git" ]]; then
    log_info "Updating existing installation..."
    cd "${INSTALL_DIR}"
    git pull origin "${BRANCH}" 2>/dev/null || true
else
    if [[ -d "${INSTALL_DIR}" ]]; then
        log_warn "Existing installation found at ${INSTALL_DIR}"
        log_info "Backing up to ${INSTALL_DIR}.bak..."
        mv "${INSTALL_DIR}" "${INSTALL_DIR}.bak.$(date +%s)"
    fi

    log_info "Cloning SparkBox to ${INSTALL_DIR}..."
    git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" 2>/dev/null || {
        # Fallback: download as ZIP if git clone fails
        log_warn "Git clone failed. Downloading ZIP..."
        local tmp_zip
        tmp_zip=$(mktemp)
        curl -sSL "${REPO_URL}/archive/refs/heads/${BRANCH}.zip" -o "${tmp_zip}"
        apt-get install -y -qq unzip > /dev/null 2>&1
        unzip -q "${tmp_zip}" -d /tmp/sparkbox-extract
        mv /tmp/sparkbox-extract/sparkbox-*/ "${INSTALL_DIR}"
        rm -rf "${tmp_zip}" /tmp/sparkbox-extract
    }
fi

# --- Setup ---

chmod +x "${INSTALL_DIR}/sparkbox"
chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true

# Symlink CLI to PATH
ln -sf "${INSTALL_DIR}/sparkbox" /usr/local/bin/sparkbox

# Create required directories
mkdir -p "${INSTALL_DIR}/state"
mkdir -p "${INSTALL_DIR}/backups"

log_ok "SparkBox installed to ${INSTALL_DIR}"
echo ""

# --- Configure Firewall ---

if command -v ufw &>/dev/null; then
    log_info "Configuring firewall (UFW)..."
    # Allow SSH first so we don't lock ourselves out
    ufw allow 22/tcp comment "SSH" > /dev/null 2>&1
    # Web traffic (HTTP/HTTPS via Nginx Proxy Manager)
    ufw allow 80/tcp comment "HTTP" > /dev/null 2>&1
    ufw allow 443/tcp comment "HTTPS" > /dev/null 2>&1
    # WireGuard VPN (only needed if VPN module is enabled, harmless otherwise)
    ufw allow 51820/udp comment "WireGuard VPN" > /dev/null 2>&1
    # Enable firewall (non-interactive)
    echo "y" | ufw enable > /dev/null 2>&1
    ufw reload > /dev/null 2>&1
    log_ok "Firewall configured: SSH (22), HTTP (80), HTTPS (443), WireGuard (51820/udp)"
else
    log_info "Installing UFW firewall..."
    apt-get install -y -qq ufw > /dev/null 2>&1
    if command -v ufw &>/dev/null; then
        ufw default deny incoming > /dev/null 2>&1
        ufw default allow outgoing > /dev/null 2>&1
        ufw allow 22/tcp comment "SSH" > /dev/null 2>&1
        ufw allow 80/tcp comment "HTTP" > /dev/null 2>&1
        ufw allow 443/tcp comment "HTTPS" > /dev/null 2>&1
        ufw allow 51820/udp comment "WireGuard VPN" > /dev/null 2>&1
        echo "y" | ufw enable > /dev/null 2>&1
        log_ok "Firewall installed and configured: SSH (22), HTTP (80), HTTPS (443), WireGuard (51820/udp)"
    else
        log_warn "Could not install UFW. Please configure your firewall manually."
        log_warn "Only ports 22, 80, 443, and 51820/udp should be open."
    fi
fi

# --- Run Setup Wizard ---

log_info "Launching setup wizard..."
echo ""
bash "${INSTALL_DIR}/scripts/setup.sh"

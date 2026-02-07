#!/usr/bin/env bash
# ==========================================
# SparkBox - Docker Auto-Installer
# Installs Docker Engine + Compose v2 on Ubuntu/Debian
# ==========================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[Docker]${NC} $*"; }
log_ok() { echo -e "${GREEN}[Docker]${NC} $*"; }
log_error() { echo -e "${RED}[Docker]${NC} $*"; }

if [[ $EUID -ne 0 ]]; then
    log_error "Must be run as root."
    exit 1
fi

# Check if Docker is already installed
if command -v docker &>/dev/null; then
    log_ok "Docker is already installed: $(docker --version)"
    if docker compose version &>/dev/null; then
        log_ok "Docker Compose: $(docker compose version --short)"
    fi
    exit 0
fi

log_info "Installing Docker Engine..."

# Remove old versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install via convenience script
curl -fsSL https://get.docker.com | sh

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Verify installation
if command -v docker &>/dev/null; then
    log_ok "Docker installed: $(docker --version)"
else
    log_error "Docker installation failed."
    exit 1
fi

if docker compose version &>/dev/null; then
    log_ok "Docker Compose: $(docker compose version --short)"
else
    log_error "Docker Compose v2 not available."
    exit 1
fi

log_ok "Docker is ready."

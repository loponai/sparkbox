#!/usr/bin/env bash
# ==========================================
# SparkBox - Interactive Setup Wizard
# Configures modules, generates .env, deploys stack
# ==========================================

set -euo pipefail

SB_ROOT="${SB_ROOT:-/opt/sparkbox}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/tui.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[Setup]${NC} $*"; }
log_ok() { echo -e "${GREEN}[Setup]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[Setup]${NC} $*"; }
log_error() { echo -e "${RED}[Setup]${NC} $*"; }

# Generate a random secret
gen_secret() {
    openssl rand -hex 32
}

gen_password() {
    openssl rand -base64 16 | tr -d '/+=' | head -c 16
}

# Hash password using bcrypt via Node.js (if available) or Python
# SECURITY: Password passed via environment variable to prevent shell injection
hash_password() {
    local password="$1"
    # Try Node.js first (bcryptjs is already installed in dashboard)
    if command -v node &>/dev/null && [[ -f "${SB_ROOT}/dashboard/node_modules/bcryptjs/index.js" ]]; then
        SB_HASH_INPUT="$password" SB_BCRYPT_PATH="${SB_ROOT}/dashboard/node_modules/bcryptjs" \
            node -e "const b=require(process.env.SB_BCRYPT_PATH);console.log(b.hashSync(process.env.SB_HASH_INPUT,12))"
        return
    fi
    # Fallback to Python bcrypt
    if python3 -c "import bcrypt" &>/dev/null; then
        SB_HASH_INPUT="$password" \
            python3 -c "import os,bcrypt;print(bcrypt.hashpw(os.environ['SB_HASH_INPUT'].encode(),bcrypt.gensalt(12)).decode())"
        return
    fi
    # Last resort: htpasswd (already safe - uses argument, not interpolation)
    if command -v htpasswd &>/dev/null; then
        htpasswd -nbBC 12 "" "${password}" | cut -d: -f2
        return
    fi
    # Absolute fallback: SHA-256 (will be auto-upgraded on first login)
    log_warn "bcrypt not available - using SHA-256 (will be upgraded on first login)"
    echo -n "${password}" | openssl dgst -sha256 | awk '{print $2}'
}

# --- Welcome ---

tui_msgbox "SparkBox Setup" "Welcome to SparkBox! 🎉

This wizard will set up your private server step by step.

You'll choose which features to turn on and enter a few settings
like your domain name and VPN credentials.

Don't worry - you can change everything later from the dashboard.
All passwords will be auto-generated if you leave them blank.

Press OK to get started."

# --- System Settings ---

log_info "Configuring system settings..."

SB_DOMAIN=$(tui_input "Server Address" \
    "Enter your server's IP address or domain name.

If you don't have a domain yet, enter your VPS IP address.
(Find it in your hosting provider's control panel.)

Example IP: 203.0.113.42
Example domain: myserver.com" \
    "localhost")

TZ=$(tui_input "Timezone" \
    "Enter your timezone (Continent/City format).

Common examples:
  America/New_York     (US Eastern)
  America/Chicago      (US Central)
  America/Los_Angeles  (US Pacific)
  Europe/London        (UK)
  Europe/Berlin        (Central Europe)
  Asia/Tokyo           (Japan)
  Australia/Sydney     (Australia)" \
    "UTC")

# --- Module Selection ---

log_info "Selecting modules..."

SELECTED_MODULES=$(tui_checklist "Choose Your Features" \
    "Pick which features you want on your server:" \
    "privacy"    "Block ads + store passwords + protect logins"         "ON" \
    "cloud"      "Private file sync (like Google Drive, but yours)"    "OFF" \
    "monitoring" "Get alerts if a service goes down"                    "ON" \
    "vpn"        "Access your server securely from anywhere"           "OFF" \
    "files"      "Web-based file manager (browse/upload via browser)"  "OFF")

# Clean up whiptail output (removes quotes)
SELECTED_MODULES=$(echo "${SELECTED_MODULES}" | tr -d '"')

# Write modules.conf
mkdir -p "${SB_ROOT}/state"
{
    echo "core"
    echo "dashboard"
    for module in ${SELECTED_MODULES}; do
        echo "${module}"
    done
} > "${SB_ROOT}/state/modules.conf"

log_ok "Modules configured: core dashboard ${SELECTED_MODULES}"

# --- Dashboard Password ---

log_info "Setting up dashboard access..."

ADMIN_PASSWORD=$(tui_password "Dashboard Password" "Set a password for your SparkBox Dashboard (leave blank to auto-generate):")

if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD=$(gen_password)
fi

SB_ADMIN_PASSWORD_HASH=$(hash_password "${ADMIN_PASSWORD}")
SB_SESSION_SECRET=$(gen_secret)
SB_BACKUP_KEY=$(gen_secret)

# --- Module-specific Configuration ---

# Privacy settings
PIHOLE_PASSWORD=""
VAULTWARDEN_ADMIN_TOKEN=""
AUTHELIA_JWT_SECRET=""
AUTHELIA_SESSION_SECRET=""
AUTHELIA_STORAGE_ENCRYPTION_KEY=""

if echo "${SELECTED_MODULES}" | grep -q "privacy"; then
    log_info "Configuring privacy module..."

    PIHOLE_PASSWORD=$(tui_password "Pi-hole Password" "Set a password for the Pi-hole ad-blocker admin panel (leave blank to auto-generate):")
    if [[ -z "${PIHOLE_PASSWORD}" ]]; then
        PIHOLE_PASSWORD=$(gen_password)
    fi

    VAULTWARDEN_ADMIN_TOKEN=$(gen_secret)
    AUTHELIA_JWT_SECRET=$(gen_secret)
    AUTHELIA_SESSION_SECRET=$(gen_secret)
    AUTHELIA_STORAGE_ENCRYPTION_KEY=$(gen_secret)

    # Generate Authelia configuration
    if [[ -f "${SB_ROOT}/templates/authelia-config.yml.tmpl" ]]; then
        mkdir -p "${SB_ROOT}/modules/privacy/config/authelia"
        sed \
            -e "s|{{SB_DOMAIN}}|${SB_DOMAIN}|g" \
            -e "s|{{AUTHELIA_JWT_SECRET}}|${AUTHELIA_JWT_SECRET}|g" \
            -e "s|{{AUTHELIA_SESSION_SECRET}}|${AUTHELIA_SESSION_SECRET}|g" \
            -e "s|{{AUTHELIA_STORAGE_ENCRYPTION_KEY}}|${AUTHELIA_STORAGE_ENCRYPTION_KEY}|g" \
            "${SB_ROOT}/templates/authelia-config.yml.tmpl" \
            > "${SB_ROOT}/modules/privacy/config/authelia/configuration.yml"
        log_ok "Authelia configuration generated."
    fi
fi

# Cloud settings
NEXTCLOUD_DB_ROOT_PASSWORD=""
NEXTCLOUD_DB_PASSWORD=""

if echo "${SELECTED_MODULES}" | grep -q "cloud"; then
    log_info "Configuring cloud module..."
    NEXTCLOUD_DB_ROOT_PASSWORD=$(gen_secret)
    NEXTCLOUD_DB_PASSWORD=$(gen_secret)
    log_ok "Nextcloud database passwords auto-generated."
fi

# WireGuard VPN Access settings
WG_PASSWORD=""
WG_PASSWORD_HASH=""

if echo "${SELECTED_MODULES}" | grep -q "vpn"; then
    log_info "Configuring VPN access module..."

    WG_PASSWORD=$(tui_password "WireGuard UI Password" "Set a password for the WireGuard VPN management panel (leave blank to auto-generate):")
    if [[ -z "${WG_PASSWORD}" ]]; then
        WG_PASSWORD=$(gen_password)
    fi
    # Generate bcrypt hash for wg-easy
    if command -v docker &>/dev/null; then
        WG_PASSWORD_HASH=$(docker run --rm ghcr.io/wg-easy/wg-easy wgpw "${WG_PASSWORD}" 2>/dev/null | tail -1 || echo "${WG_PASSWORD}")
    else
        WG_PASSWORD_HASH="${WG_PASSWORD}"
        log_warn "Docker not available to generate bcrypt hash for wg-easy. Password stored as plaintext."
    fi
fi

# --- Generate .env ---

log_info "Generating configuration file..."

cat > "${SB_ROOT}/.env" << ENVEOF
# ==========================================
# SPARKBOX - Generated Configuration
# Generated: $(date)
# DO NOT share this file - it contains secrets!
# ==========================================

# --- SYSTEM ---
TZ=${TZ}
SB_ROOT=${SB_ROOT}
SB_DOMAIN=${SB_DOMAIN}

# --- DASHBOARD ---
SB_ADMIN_PASSWORD_HASH=${SB_ADMIN_PASSWORD_HASH}
SB_SESSION_SECRET=${SB_SESSION_SECRET}
# Backup encryption key - keep this safe! Without it, encrypted backups are unrecoverable.
SB_BACKUP_KEY=${SB_BACKUP_KEY}

# --- PRIVACY MODULE ---
PIHOLE_PASSWORD=${PIHOLE_PASSWORD}
VAULTWARDEN_ADMIN_TOKEN=${VAULTWARDEN_ADMIN_TOKEN}
VAULTWARDEN_DOMAIN=https://vault.${SB_DOMAIN}
AUTHELIA_JWT_SECRET=${AUTHELIA_JWT_SECRET}
AUTHELIA_SESSION_SECRET=${AUTHELIA_SESSION_SECRET}
AUTHELIA_STORAGE_ENCRYPTION_KEY=${AUTHELIA_STORAGE_ENCRYPTION_KEY}

# --- CLOUD MODULE ---
NEXTCLOUD_DB_ROOT_PASSWORD=${NEXTCLOUD_DB_ROOT_PASSWORD}
NEXTCLOUD_DB_PASSWORD=${NEXTCLOUD_DB_PASSWORD}

# --- VPN ACCESS MODULE ---
WG_PASSWORD_HASH=${WG_PASSWORD_HASH}

ENVEOF

chmod 600 "${SB_ROOT}/.env"
log_ok "Configuration saved to ${SB_ROOT}/.env"

# --- Save credentials to a secure file ---

CREDS_FILE="${SB_ROOT}/state/initial-credentials.txt"
{
    echo "================================================"
    echo "  SparkBox Credentials - SAVE THESE SECURELY!"
    echo "  Generated: $(date)"
    echo "  Delete this file after saving your passwords."
    echo "================================================"
    echo ""
    echo "Dashboard: https://${SB_DOMAIN}"
    echo "Password:  ${ADMIN_PASSWORD}"
    echo ""
    if echo "${SELECTED_MODULES}" | grep -q "privacy"; then
        echo "Pi-hole Admin: https://pihole.${SB_DOMAIN}/admin"
        echo "Password: ${PIHOLE_PASSWORD}"
        echo ""
    fi
    if echo "${SELECTED_MODULES}" | grep -q "vpn"; then
        echo "WireGuard VPN UI: https://wg.${SB_DOMAIN}"
        echo "Password: ${WG_PASSWORD}"
        echo ""
    fi
} > "${CREDS_FILE}"
chmod 600 "${CREDS_FILE}"

# --- Generate Homepage Config ---

if [[ -f "${SB_ROOT}/templates/homepage-services.yml.tmpl" ]]; then
    mkdir -p "${SB_ROOT}/modules/core/config/homepage"
    echo "# Auto-generated by SparkBox setup" > "${SB_ROOT}/modules/core/config/homepage/services.yaml"
    echo "# Homepage will auto-discover services via Docker labels" >> "${SB_ROOT}/modules/core/config/homepage/services.yaml"
fi

# --- Deploy ---

if tui_yesno "Deploy" "Configuration complete! Deploy SparkBox now?"; then
    log_info "Deploying SparkBox..."
    echo ""
    "${SB_ROOT}/sparkbox" up
else
    log_info "Setup complete. Run 'sparkbox up' when ready to deploy."
fi

# --- Summary ---

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}  SparkBox Setup Complete!${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""
echo -e "  ${BOLD}Your credentials have been saved to:${NC}"
echo -e "  ${CREDS_FILE}"
echo ""
echo -e "  ${YELLOW}Read that file, save the passwords somewhere safe,${NC}"
echo -e "  ${YELLOW}then delete it: rm ${CREDS_FILE}${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC} https://${SB_DOMAIN}"
echo -e "  ${BOLD}CLI:${NC} sparkbox status | sparkbox help"
echo ""

# Log install
mkdir -p "${SB_ROOT}/state"
echo "[$(date)] Setup completed. Modules: core dashboard ${SELECTED_MODULES}" >> "${SB_ROOT}/state/install.log"

#!/usr/bin/env bash
# ==========================================
# SparkBox - Interactive Setup Wizard
# Configures modules, generates .env, deploys stack
# Dynamically reads module metadata from x-sparkbox
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

# Read a scalar field from x-sparkbox metadata
read_sparkbox_field() {
    local compose="$1"
    local field="$2"
    sed -n '/^x-sparkbox:/,/^[a-z]/p' "${compose}" | \
        grep -E "^  ${field}:" | head -1 | \
        sed "s/^  ${field}:[[:space:]]*//" | \
        sed 's/^"\(.*\)"$/\1/' | sed "s/^'\(.*\)'$/\1/"
}

# Parse env_vars from x-sparkbox using Node.js + js-yaml (already installed)
parse_env_vars() {
    local compose="$1"
    # Returns JSON array: [{key, type, label, prompt, default}]
    if command -v node &>/dev/null && [[ -f "${SB_ROOT}/dashboard/node_modules/js-yaml/index.js" ]]; then
        SB_COMPOSE_PATH="${compose}" SB_YAML_PATH="${SB_ROOT}/dashboard/node_modules/js-yaml" \
            node -e "
const yaml=require(process.env.SB_YAML_PATH);
const fs=require('fs');
const doc=yaml.load(fs.readFileSync(process.env.SB_COMPOSE_PATH,'utf8'));
const ev=(doc['x-sparkbox']||{}).env_vars||{};
const result=Object.entries(ev).map(([k,v])=>({key:k,type:v.type||'text',label:v.label||k,prompt:v.prompt||'',default:v.default||''}));
console.log(JSON.stringify(result));
"
    else
        echo "[]"
    fi
}

# Parse setup.templates from x-sparkbox using Node.js
parse_setup_templates() {
    local compose="$1"
    if command -v node &>/dev/null && [[ -f "${SB_ROOT}/dashboard/node_modules/js-yaml/index.js" ]]; then
        SB_COMPOSE_PATH="${compose}" SB_YAML_PATH="${SB_ROOT}/dashboard/node_modules/js-yaml" \
            node -e "
const yaml=require(process.env.SB_YAML_PATH);
const fs=require('fs');
const doc=yaml.load(fs.readFileSync(process.env.SB_COMPOSE_PATH,'utf8'));
const setup=(doc['x-sparkbox']||{}).setup||{};
const templates=setup.templates||[];
console.log(JSON.stringify(templates));
"
    else
        echo "[]"
    fi
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

# --- Module Selection (Dynamic) ---

log_info "Selecting modules..."

# Build checklist args dynamically from module metadata
CHECKLIST_ARGS=()
for dir in "${SB_ROOT}/modules"/*/; do
    compose="${dir}docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    mod_id=$(read_sparkbox_field "${compose}" "id")
    [[ -z "${mod_id}" ]] && mod_id=$(basename "${dir}")
    required=$(read_sparkbox_field "${compose}" "required")
    [[ "${required}" == "true" ]] && continue  # Skip core modules

    title=$(read_sparkbox_field "${compose}" "title")
    tagline=$(read_sparkbox_field "${compose}" "tagline")
    default_val=$(read_sparkbox_field "${compose}" "default")

    [[ -z "${title}" ]] && title="${mod_id}"
    local_desc="${tagline:-${title}}"
    local_state="OFF"
    [[ "${default_val}" == "true" ]] && local_state="ON"

    CHECKLIST_ARGS+=("${mod_id}" "${local_desc}" "${local_state}")
done

SELECTED_MODULES=""
if [[ ${#CHECKLIST_ARGS[@]} -gt 0 ]]; then
    SELECTED_MODULES=$(tui_checklist "Choose Your Features" \
        "Pick which features you want on your server:" \
        "${CHECKLIST_ARGS[@]}")
fi

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

# --- Module-specific Configuration (Dynamic) ---

# Associative array to store all env var values
declare -A ENV_VALUES

for module in ${SELECTED_MODULES}; do
    compose="${SB_ROOT}/modules/${module}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    title=$(read_sparkbox_field "${compose}" "title")
    [[ -z "${title}" ]] && title="${module}"

    env_vars_json=$(parse_env_vars "${compose}")
    [[ "${env_vars_json}" == "[]" ]] && continue

    log_info "Configuring ${title}..."

    # Process each env var based on its type
    while IFS= read -r var_line; do
        var_key=$(echo "${var_line}" | sed 's/^"\(.*\)"$/\1/')
        [[ -z "${var_key}" ]] && continue

        var_type=$(SB_COMPOSE_PATH="${compose}" SB_YAML_PATH="${SB_ROOT}/dashboard/node_modules/js-yaml" SB_VAR_KEY="${var_key}" \
            node -e "
const yaml=require(process.env.SB_YAML_PATH);
const fs=require('fs');
const doc=yaml.load(fs.readFileSync(process.env.SB_COMPOSE_PATH,'utf8'));
const ev=(doc['x-sparkbox']||{}).env_vars||{};
const v=ev[process.env.SB_VAR_KEY]||{};
console.log(v.type||'text');
" 2>/dev/null || echo "text")

        var_prompt=$(SB_COMPOSE_PATH="${compose}" SB_YAML_PATH="${SB_ROOT}/dashboard/node_modules/js-yaml" SB_VAR_KEY="${var_key}" \
            node -e "
const yaml=require(process.env.SB_YAML_PATH);
const fs=require('fs');
const doc=yaml.load(fs.readFileSync(process.env.SB_COMPOSE_PATH,'utf8'));
const ev=(doc['x-sparkbox']||{}).env_vars||{};
const v=ev[process.env.SB_VAR_KEY]||{};
console.log(v.prompt||'');
" 2>/dev/null || echo "")

        var_default=$(SB_COMPOSE_PATH="${compose}" SB_YAML_PATH="${SB_ROOT}/dashboard/node_modules/js-yaml" SB_VAR_KEY="${var_key}" \
            node -e "
const yaml=require(process.env.SB_YAML_PATH);
const fs=require('fs');
const doc=yaml.load(fs.readFileSync(process.env.SB_COMPOSE_PATH,'utf8'));
const ev=(doc['x-sparkbox']||{}).env_vars||{};
const v=ev[process.env.SB_VAR_KEY]||{};
console.log(v.default||'');
" 2>/dev/null || echo "")

        case "${var_type}" in
            secret)
                ENV_VALUES["${var_key}"]=$(gen_secret)
                ;;
            password)
                local pw_val=""
                if [[ -n "${var_prompt}" ]]; then
                    pw_val=$(tui_password "${var_key}" "${var_prompt}")
                fi
                if [[ -z "${pw_val}" ]]; then
                    # Special handling for WG_PASSWORD_HASH - needs bcrypt via docker
                    if [[ "${var_key}" == "WG_PASSWORD_HASH" ]]; then
                        local raw_pw
                        raw_pw=$(gen_password)
                        if command -v docker &>/dev/null; then
                            ENV_VALUES["${var_key}"]=$(docker run --rm ghcr.io/wg-easy/wg-easy wgpw "${raw_pw}" 2>/dev/null | tail -1 || echo "${raw_pw}")
                        else
                            ENV_VALUES["${var_key}"]="${raw_pw}"
                        fi
                        # Save raw password for credentials file
                        ENV_VALUES["_WG_PASSWORD_RAW"]="${raw_pw}"
                    else
                        ENV_VALUES["${var_key}"]=$(gen_password)
                    fi
                else
                    if [[ "${var_key}" == "WG_PASSWORD_HASH" ]]; then
                        if command -v docker &>/dev/null; then
                            ENV_VALUES["${var_key}"]=$(docker run --rm ghcr.io/wg-easy/wg-easy wgpw "${pw_val}" 2>/dev/null | tail -1 || echo "${pw_val}")
                        else
                            ENV_VALUES["${var_key}"]="${pw_val}"
                        fi
                        ENV_VALUES["_WG_PASSWORD_RAW"]="${pw_val}"
                    else
                        ENV_VALUES["${var_key}"]="${pw_val}"
                    fi
                fi
                ;;
            text|path)
                if [[ -n "${var_prompt}" ]]; then
                    ENV_VALUES["${var_key}"]=$(tui_input "${var_key}" "${var_prompt}" "${var_default}")
                elif [[ -n "${var_default}" ]]; then
                    # Expand SB_DOMAIN in defaults
                    local expanded
                    expanded=$(echo "${var_default}" | sed "s/\${SB_DOMAIN}/${SB_DOMAIN}/g")
                    ENV_VALUES["${var_key}"]="${expanded}"
                fi
                ;;
            boolean)
                ENV_VALUES["${var_key}"]="${var_default:-false}"
                ;;
        esac
    done < <(echo "${env_vars_json}" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.forEach(v=>console.log(JSON.stringify(v.key)));
" 2>/dev/null || true)

    log_ok "${title} configured."
done

# --- Process setup templates ---

for module in ${SELECTED_MODULES}; do
    compose="${SB_ROOT}/modules/${module}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    templates_json=$(parse_setup_templates "${compose}")
    [[ "${templates_json}" == "[]" ]] && continue

    while IFS= read -r tmpl_line; do
        [[ -z "${tmpl_line}" ]] && continue
        tmpl_source=$(echo "${tmpl_line}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.source||'')" 2>/dev/null || echo "")
        tmpl_dest=$(echo "${tmpl_line}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.dest||'')" 2>/dev/null || echo "")

        [[ -z "${tmpl_source}" || -z "${tmpl_dest}" ]] && continue

        local src_path="${SB_ROOT}/${tmpl_source}"
        local dest_path="${SB_ROOT}/${tmpl_dest}"

        if [[ -f "${src_path}" ]]; then
            mkdir -p "$(dirname "${dest_path}")"
            local content
            content=$(cat "${src_path}")

            # Replace template variables
            content=$(echo "${content}" | sed \
                -e "s|{{SB_DOMAIN}}|${SB_DOMAIN}|g")

            # Replace any env_var keys
            for key in "${!ENV_VALUES[@]}"; do
                [[ "${key}" == _* ]] && continue  # Skip internal keys
                content=$(echo "${content}" | sed "s|{{${key}}}|${ENV_VALUES[${key}]}|g")
            done

            echo "${content}" > "${dest_path}"
            log_ok "Template rendered: ${tmpl_dest}"
        fi
    done < <(echo "${templates_json}" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.forEach(t=>console.log(JSON.stringify(t)));
" 2>/dev/null || true)
done

# --- Generate .env ---

log_info "Generating configuration file..."

{
    echo "# =========================================="
    echo "# SPARKBOX - Generated Configuration"
    echo "# Generated: $(date)"
    echo "# DO NOT share this file - it contains secrets!"
    echo "# =========================================="
    echo ""
    echo "# --- SYSTEM ---"
    echo "TZ=${TZ}"
    echo "SB_ROOT=${SB_ROOT}"
    echo "SB_DOMAIN=${SB_DOMAIN}"
    echo ""
    echo "# --- DASHBOARD ---"
    echo "SB_ADMIN_PASSWORD_HASH=${SB_ADMIN_PASSWORD_HASH}"
    echo "SB_SESSION_SECRET=${SB_SESSION_SECRET}"
    echo "# Backup encryption key - keep this safe! Without it, encrypted backups are unrecoverable."
    echo "SB_BACKUP_KEY=${SB_BACKUP_KEY}"

    # Write module-specific env vars
    for module in ${SELECTED_MODULES}; do
        compose="${SB_ROOT}/modules/${module}/docker-compose.yml"
        [[ -f "${compose}" ]] || continue

        title=$(read_sparkbox_field "${compose}" "title")
        [[ -z "${title}" ]] && title="${module}"

        env_vars_json=$(parse_env_vars "${compose}")
        [[ "${env_vars_json}" == "[]" ]] && continue

        echo ""
        echo "# --- ${title^^} ---"
        while IFS= read -r var_key; do
            var_key=$(echo "${var_key}" | sed 's/^"\(.*\)"$/\1/')
            [[ -z "${var_key}" || "${var_key}" == _* ]] && continue
            echo "${var_key}=${ENV_VALUES[${var_key}]:-}"
        done < <(echo "${env_vars_json}" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.forEach(v=>console.log(JSON.stringify(v.key)));
" 2>/dev/null || true)
    done
} > "${SB_ROOT}/.env"

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
    # Show module-specific passwords
    if [[ -n "${ENV_VALUES[PIHOLE_PASSWORD]:-}" ]]; then
        echo "Pi-hole Admin: https://pihole.${SB_DOMAIN}/admin"
        echo "Password: ${ENV_VALUES[PIHOLE_PASSWORD]}"
        echo ""
    fi
    if [[ -n "${ENV_VALUES[_WG_PASSWORD_RAW]:-}" ]]; then
        echo "WireGuard VPN UI: https://wg.${SB_DOMAIN}"
        echo "Password: ${ENV_VALUES[_WG_PASSWORD_RAW]}"
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

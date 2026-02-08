#!/usr/bin/env bash
# ==========================================
# SparkBox - Stack Validation Script
# Validates compose files, env vars, ports, and naming
# Dynamically discovers modules from filesystem
# Run: bash scripts/validate.sh
# ==========================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $*"; WARN=$((WARN + 1)); }
section() { echo ""; echo -e "${BOLD}${CYAN}[$1]${NC}"; }

# --- Discover modules dynamically ---

DISCOVERED_MODULES=""
for dir in "${SB_ROOT}/modules"/*/; do
    mod=$(basename "${dir}")
    if [[ -f "${dir}docker-compose.yml" ]]; then
        DISCOVERED_MODULES="${DISCOVERED_MODULES} ${mod}"
    fi
done
DISCOVERED_MODULES=$(echo "${DISCOVERED_MODULES}" | xargs)  # trim

echo -e "${BOLD}Discovered modules:${NC} ${DISCOVERED_MODULES}"

# --- Generate test .env ---

TEST_ENV="${SB_ROOT}/.env.test"
generate_test_env() {
    # Start with system vars
    cat > "${TEST_ENV}" << 'EOF'
TZ=UTC
SB_ROOT=/opt/sparkbox
SB_DOMAIN=test.example.com
SB_ADMIN_PASSWORD_HASH=$2a$12$testhashtesthasttesthash
SB_SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000
SB_BACKUP_KEY=0000000000000000000000000000000000000000000000000000000000000001
EOF

    # Dynamically add any env vars referenced in compose files
    local compose_vars
    compose_vars=$(grep -rhE '\$\{[A-Z_]+' "${SB_ROOT}/modules/" --include='*.yml' 2>/dev/null | \
        grep -oE '\$\{[A-Z_]+' | sed 's/\${//' | sort -u || true)

    for var in ${compose_vars}; do
        # Skip vars already in test env or system vars with defaults
        if grep -q "^${var}=" "${TEST_ENV}" 2>/dev/null; then
            continue
        fi
        # Skip vars that have defaults in compose (${VAR:-default})
        if grep -qE "\\\$\\{${var}:-" "${SB_ROOT}/modules/"*"/docker-compose.yml" 2>/dev/null; then
            continue
        fi
        # Add a test value
        echo "${var}=test_value_for_${var}" >> "${TEST_ENV}"
    done
}

cleanup() {
    rm -f "${TEST_ENV}"
}
trap cleanup EXIT

# ==========================================
# TEST 1: Module directories
# ==========================================
section "Module Directories"

for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    if [[ -f "${compose}" ]]; then
        pass "${mod}/docker-compose.yml exists"
    else
        fail "${mod}/docker-compose.yml MISSING"
    fi
done

# ==========================================
# TEST 2: YAML syntax validation
# ==========================================
section "YAML Syntax"

for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue
    if python3 -c "import yaml; yaml.safe_load(open('${compose}'))" 2>/dev/null; then
        pass "${mod}/docker-compose.yml valid YAML"
    else
        fail "${mod}/docker-compose.yml INVALID YAML"
    fi
done

# ==========================================
# TEST 3: Docker Compose config validation
# ==========================================
section "Docker Compose Config"

generate_test_env

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    for mod in ${DISCOVERED_MODULES}; do
        compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
        [[ -f "${compose}" ]] || continue
        if docker compose --env-file "${TEST_ENV}" -f "${compose}" config -q 2>/dev/null; then
            pass "${mod} compose config OK"
        else
            fail "${mod} compose config FAILED"
        fi
    done

    # Multi-file compose (all modules)
    ALL_ARGS=""
    for mod in ${DISCOVERED_MODULES}; do
        compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
        [[ -f "${compose}" ]] && ALL_ARGS="${ALL_ARGS} -f ${compose}"
    done
    if docker compose --env-file "${TEST_ENV}" -p sparkbox ${ALL_ARGS} config -q 2>/dev/null; then
        pass "All modules combined compose config OK"
    else
        fail "All modules combined compose config FAILED"
    fi
else
    warn "Docker not available — skipping compose config validation"
    warn "Install Docker to enable full validation"
fi

# ==========================================
# TEST 4: Naming conventions (sb- prefix)
# ==========================================
section "Naming Conventions"

for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    # Check for ms- or megastack references (wrong project)
    if grep -qE 'ms-|MS_|megastack|x-megastack|ms_' "${compose}" 2>/dev/null; then
        fail "${mod} contains megastack naming references"
        grep -nE 'ms-|MS_|megastack|x-megastack|ms_' "${compose}" | head -5
    else
        pass "${mod} no megastack naming leaks"
    fi

    # Check all container_name use sb- prefix
    while IFS= read -r line; do
        name=$(echo "$line" | awk '{print $2}')
        if [[ "${name}" != sb-* ]]; then
            fail "${mod} container '${name}' missing sb- prefix"
        fi
    done < <(grep 'container_name:' "${compose}" 2>/dev/null || true)
done

# Check x-sparkbox metadata exists
for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue
    if grep -q 'x-sparkbox:' "${compose}" 2>/dev/null; then
        pass "${mod} has x-sparkbox metadata"
    else
        fail "${mod} MISSING x-sparkbox metadata"
    fi
done

# ==========================================
# TEST 5: Network subnet conflicts
# ==========================================
section "Network Subnets"

declare -A SUBNETS
CONFLICT=0
while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    subnet=$(echo "$line" | grep -oE '172\.20\.[0-9]+\.0/24')
    mod=$(echo "$file" | sed 's|.*/modules/||; s|/.*||')

    if [[ -n "${subnet}" ]]; then
        if [[ -n "${SUBNETS[$subnet]:-}" ]]; then
            fail "Subnet ${subnet} conflict: ${mod} vs ${SUBNETS[$subnet]}"
            CONFLICT=1
        else
            SUBNETS[$subnet]="${mod}"
            pass "Subnet ${subnet} → ${mod}"
        fi
    fi
done < <(grep -r 'subnet:' "${SB_ROOT}/modules/" 2>/dev/null || true)

if [[ ${CONFLICT} -eq 0 ]]; then
    pass "No subnet conflicts (${#SUBNETS[@]} unique subnets)"
fi

# ==========================================
# TEST 6: Port conflicts
# ==========================================
section "Port Conflicts"

declare -A PORTS || true
PORT_CONFLICT=0
PORT_COUNT=0
for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue
    while IFS= read -r port; do
        [[ -z "${port}" ]] && continue
        if [[ -n "${PORTS[$port]:-}" && "${PORTS[$port]}" != "${mod}" ]]; then
            fail "Port ${port} conflict: ${mod} vs ${PORTS[$port]}"
            PORT_CONFLICT=1
        else
            PORTS[$port]="${mod}"
            PORT_COUNT=$((PORT_COUNT + 1))
        fi
    done < <(grep -E '^\s*-\s*".*:.*:' "${compose}" 2>/dev/null | grep -oE '"[^"]*"' | tr -d '"' | while IFS= read -r mapping; do
        echo "${mapping}" | rev | cut -d: -f2 | rev | tr -d ' '
    done | sort -u || true)
done

if [[ ${PORT_CONFLICT} -eq 0 ]]; then
    pass "No port conflicts (${PORT_COUNT} port mappings checked)"
fi

# ==========================================
# TEST 7: Environment variable coverage
# ==========================================
section "Environment Variables"

COMPOSE_VARS=$(grep -rhE '\$\{[A-Z_]+' "${SB_ROOT}/modules/" --include='*.yml' 2>/dev/null | \
    grep -oE '\$\{[A-Z_]+' | sed 's/\${//' | sort -u)

ENV_EXAMPLE="${SB_ROOT}/.env.example"
if [[ -f "${ENV_EXAMPLE}" ]]; then
    for var in ${COMPOSE_VARS}; do
        if grep -q "^${var}=" "${ENV_EXAMPLE}" 2>/dev/null || grep -q "^# ${var}=" "${ENV_EXAMPLE}" 2>/dev/null; then
            pass "${var} documented in .env.example"
        else
            if grep -qE "\\\$\\{${var}:-" "${SB_ROOT}/modules/"*"/docker-compose.yml" 2>/dev/null; then
                pass "${var} has default in compose"
            else
                # Check if it's defined in x-sparkbox.env_vars (dynamically managed)
                if grep -qE "^    ${var}:" "${SB_ROOT}/modules/"*"/docker-compose.yml" 2>/dev/null; then
                    pass "${var} managed via x-sparkbox.env_vars"
                else
                    warn "${var} not in .env.example (module-managed)"
                fi
            fi
        fi
    done
else
    fail ".env.example not found"
fi

# ==========================================
# TEST 8: Security (security_opt, resource limits)
# ==========================================
section "Security & Resources"

for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    svc_count=$(grep -c 'container_name:' "${compose}" 2>/dev/null || echo 0)

    secopt_count=$(grep -c 'no-new-privileges' "${compose}" 2>/dev/null || echo 0)
    if [[ ${secopt_count} -ge ${svc_count} ]]; then
        pass "${mod} all ${svc_count} services have security_opt"
    else
        fail "${mod} only ${secopt_count}/${svc_count} services have security_opt"
    fi

    limit_count=$(grep -c 'memory:' "${compose}" 2>/dev/null || echo 0)
    if [[ ${limit_count} -ge ${svc_count} ]]; then
        pass "${mod} all services have memory limits"
    else
        warn "${mod} only ${limit_count}/${svc_count} services have memory limits"
    fi

    health_count=$(grep -c 'healthcheck:' "${compose}" 2>/dev/null || echo 0)
    if [[ ${health_count} -ge ${svc_count} ]]; then
        pass "${mod} all services have healthchecks"
    else
        warn "${mod} only ${health_count}/${svc_count} services have healthchecks"
    fi

    log_count=$(grep -c 'max-size:' "${compose}" 2>/dev/null || echo 0)
    if [[ ${log_count} -ge ${svc_count} ]]; then
        pass "${mod} all services have log rotation"
    else
        warn "${mod} only ${log_count}/${svc_count} services have log rotation"
    fi
done

# ==========================================
# TEST 9: Dashboard integration (dynamic)
# ==========================================
section "Dashboard Integration"

# With the dynamic system, SERVICE_META and MODULE_INFO are no longer hardcoded.
# Instead, check that x-sparkbox metadata is parseable for each module.
for mod in ${DISCOVERED_MODULES}; do
    compose="${SB_ROOT}/modules/${mod}/docker-compose.yml"
    [[ -f "${compose}" ]] || continue

    # Check x-sparkbox has required fields
    has_id=$(grep -c '  id:' "${compose}" 2>/dev/null || echo 0)
    has_title=$(grep -c '  title:' "${compose}" 2>/dev/null || echo 0)
    has_category=$(grep -c '  category:' "${compose}" 2>/dev/null || echo 0)
    has_services=$(grep -c '  services:' "${compose}" 2>/dev/null || echo 0)

    if [[ ${has_id} -ge 1 && ${has_title} -ge 1 && ${has_category} -ge 1 ]]; then
        pass "${mod} x-sparkbox has id, title, category"
    else
        fail "${mod} x-sparkbox missing required fields (id/title/category)"
    fi

    # Check theme block
    if grep -q '  theme:' "${compose}" 2>/dev/null; then
        pass "${mod} has theme metadata"
    else
        warn "${mod} missing theme metadata"
    fi
done

# ==========================================
# TEST 10: CLI completeness
# ==========================================
section "CLI Completeness"

CLI="${SB_ROOT}/sparkbox"
if [[ -f "${CLI}" ]]; then
    # With dynamic CLI, check that discover_modules function exists
    if grep -q 'discover_modules' "${CLI}" 2>/dev/null; then
        pass "CLI uses dynamic module discovery"
    else
        # Legacy check
        if grep -q 'AVAILABLE_MODULES' "${CLI}" 2>/dev/null; then
            warn "CLI uses hardcoded AVAILABLE_MODULES (consider upgrading to dynamic)"
        else
            fail "CLI has no module discovery mechanism"
        fi
    fi

    if bash -n "${CLI}" 2>/dev/null; then
        pass "sparkbox CLI valid bash syntax"
    else
        fail "sparkbox CLI has bash syntax errors"
    fi
else
    fail "sparkbox CLI not found"
fi

SETUP="${SB_ROOT}/scripts/setup.sh"
if [[ -f "${SETUP}" ]]; then
    if bash -n "${SETUP}" 2>/dev/null; then
        pass "setup.sh valid bash syntax"
    else
        fail "setup.sh has bash syntax errors"
    fi
else
    fail "scripts/setup.sh not found"
fi

# ==========================================
# Summary
# ==========================================
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}  Validation Summary${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""
echo -e "  ${GREEN}PASS: ${PASS}${NC}"
echo -e "  ${YELLOW}WARN: ${WARN}${NC}"
echo -e "  ${RED}FAIL: ${FAIL}${NC}"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
    echo -e "  ${RED}${BOLD}VALIDATION FAILED${NC} — ${FAIL} issue(s) need fixing"
    exit 1
else
    echo -e "  ${GREEN}${BOLD}VALIDATION PASSED${NC} — all checks OK"
    exit 0
fi

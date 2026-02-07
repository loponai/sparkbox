#!/usr/bin/env bash
# ==========================================
# SparkBox - Health Check Script
# Checks container health and service availability
# ==========================================

set -euo pipefail

SB_ROOT="${SB_ROOT:-/opt/sparkbox}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_container() {
    local name="$1"
    local port="${2:-}"

    local status
    status=$(docker inspect --format='{{.State.Status}}' "${name}" 2>/dev/null || echo "not found")

    case "${status}" in
        running)
            local health
            health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}' "${name}" 2>/dev/null || echo "unknown")

            if [[ "${health}" == "unhealthy" ]]; then
                echo -e "  ${YELLOW}!${NC} ${name}: running (unhealthy)"
                return 1
            else
                echo -e "  ${GREEN}✓${NC} ${name}: running"
            fi

            # Check port if specified
            if [[ -n "${port}" ]]; then
                if curl -sf -o /dev/null --connect-timeout 3 "http://localhost:${port}" 2>/dev/null; then
                    echo -e "      Port ${port}: ${GREEN}responding${NC}"
                else
                    echo -e "      Port ${port}: ${YELLOW}not responding${NC}"
                fi
            fi
            return 0
            ;;
        *)
            echo -e "  ${RED}✗${NC} ${name}: ${status}"
            return 1
            ;;
    esac
}

echo "SparkBox Health Check"
echo "====================="
echo ""

errors=0

# Core
echo "Core:"
check_container "sb-npm" "81" || ((errors++))
check_container "sb-portainer" "9000" || ((errors++))
check_container "sb-homepage" "3000" || ((errors++))
echo ""

# Dashboard
echo "Dashboard:"
check_container "sb-dashboard" "8443" || ((errors++))
echo ""

# Check optional modules based on running containers
if docker inspect sb-pihole &>/dev/null 2>&1; then
    echo "Privacy:"
    check_container "sb-pihole" "8053" || ((errors++))
    check_container "sb-vaultwarden" "8222" || ((errors++))
    check_container "sb-authelia" "9091" || ((errors++))
    echo ""
fi

if docker inspect sb-nextcloud &>/dev/null 2>&1; then
    echo "Cloud:"
    check_container "sb-nextcloud" || ((errors++))
    check_container "sb-nextcloud-db" || ((errors++))
    check_container "sb-nextcloud-redis" || ((errors++))
    echo ""
fi

if docker inspect sb-uptime-kuma &>/dev/null 2>&1; then
    echo "Monitoring:"
    check_container "sb-uptime-kuma" "3001" || ((errors++))
    echo ""
fi

if docker inspect sb-wg-easy &>/dev/null 2>&1; then
    echo "VPN Access:"
    check_container "sb-wg-easy" "51821" || ((errors++))
    echo ""
fi

# Summary
echo "====================="
if [[ ${errors} -eq 0 ]]; then
    echo -e "${GREEN}All services healthy.${NC}"
else
    echo -e "${YELLOW}${errors} issue(s) detected.${NC}"
fi

exit ${errors}

#!/usr/bin/env bash
# ==========================================
# SparkBox - TUI Helper Functions
# whiptail-based menu helpers for setup wizard
# ==========================================

# Check whiptail availability
tui_available() {
    command -v whiptail &>/dev/null
}

# Fallback to basic read prompts if whiptail is not available
tui_input() {
    local title="$1"
    local prompt="$2"
    local default="${3:-}"

    if tui_available; then
        whiptail --inputbox "${prompt}" 10 60 "${default}" --title "${title}" 3>&1 1>&2 2>&3 || echo "${default}"
    else
        read -rp "${prompt} [${default}]: " value
        echo "${value:-${default}}"
    fi
}

tui_password() {
    local title="$1"
    local prompt="$2"

    if tui_available; then
        whiptail --passwordbox "${prompt}" 10 60 --title "${title}" 3>&1 1>&2 2>&3 || echo ""
    else
        read -rsp "${prompt}: " value
        echo ""
        echo "${value}"
    fi
}

tui_yesno() {
    local title="$1"
    local prompt="$2"

    if tui_available; then
        whiptail --yesno "${prompt}" 10 60 --title "${title}" 3>&1 1>&2 2>&3
        return $?
    else
        read -rp "${prompt} [Y/n]: " value
        [[ "${value}" != "n" && "${value}" != "N" ]]
        return $?
    fi
}

tui_checklist() {
    local title="$1"
    local prompt="$2"
    shift 2
    # Remaining args are: tag description ON/OFF ...

    if tui_available; then
        local count=$(( $# / 3 ))
        whiptail --checklist "${prompt}" 20 70 ${count} "$@" --title "${title}" 3>&1 1>&2 2>&3 || echo ""
    else
        echo "${prompt}" >&2
        local selected=""
        while [[ $# -ge 3 ]]; do
            local tag="$1" desc="$2" state="$3"
            shift 3
            if [[ "${state}" == "ON" ]]; then
                read -rp "  Enable ${tag} (${desc})? [Y/n]: " value
                if [[ "${value}" != "n" && "${value}" != "N" ]]; then
                    selected="${selected} ${tag}"
                fi
            else
                read -rp "  Enable ${tag} (${desc})? [y/N]: " value
                if [[ "${value}" == "y" || "${value}" == "Y" ]]; then
                    selected="${selected} ${tag}"
                fi
            fi
        done
        echo "${selected}"
    fi
}

tui_menu() {
    local title="$1"
    local prompt="$2"
    shift 2
    # Remaining args are: tag description ...

    if tui_available; then
        local count=$(( $# / 2 ))
        whiptail --menu "${prompt}" 20 70 ${count} "$@" --title "${title}" 3>&1 1>&2 2>&3 || echo ""
    else
        echo "${prompt}" >&2
        local i=1
        local tags=()
        while [[ $# -ge 2 ]]; do
            local tag="$1" desc="$2"
            shift 2
            echo "  ${i}) ${tag} - ${desc}" >&2
            tags+=("${tag}")
            ((i++))
        done
        read -rp "Select [1]: " value
        value="${value:-1}"
        echo "${tags[$((value-1))]}"
    fi
}

tui_msgbox() {
    local title="$1"
    local message="$2"

    if tui_available; then
        whiptail --msgbox "${message}" 20 70 --title "${title}"
    else
        echo ""
        echo "=== ${title} ==="
        echo "${message}"
        echo ""
        read -rp "Press Enter to continue..."
    fi
}

tui_gauge() {
    local title="$1"
    local percent="$2"

    if tui_available; then
        echo "${percent}" | whiptail --gauge "${title}" 7 70 0
    else
        echo "[${percent}%] ${title}"
    fi
}

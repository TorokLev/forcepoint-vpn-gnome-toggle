#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Installs or removes the Forcepoint VPN GNOME toggle.
#   ./install.sh              install or update
#   ./install.sh --uninstall  remove extension, helper and sudo rule
#   ./install.sh --purge      same, plus your config and stored password
#
# Run as your normal user; it asks for sudo where root is needed.
set -euo pipefail

UUID="forcepoint-vpn@local"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SRC="$HERE/extension/$UUID"
EXT_DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
HELPER=/usr/local/bin/fp-vpn
SUDOERS=/etc/sudoers.d/fp-vpn
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/fp-vpn.conf"
SECRET_SERVICE=forcepoint-vpn

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die "run as your normal user, not with sudo (it asks when needed)"
USER_NAME="$(id -un)"
[[ $USER_NAME =~ ^[a-z_][a-z0-9._-]*\$?$ ]] || die "unexpected user name '$USER_NAME'"

do_uninstall() {
    local purge=$1
    if [[ -x $HELPER ]]; then
        say "Disconnecting if connected"
        sudo "$HELPER" disconnect || true
    fi
    if command -v gnome-extensions >/dev/null; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    say "Removing extension, helper and sudo rule"
    rm -rf "$EXT_DEST"
    sudo rm -f "$HELPER" "$SUDOERS"
    if [[ $purge == yes ]]; then
        say "Removing $CONF and the stored password"
        rm -f "$CONF"
        command -v secret-tool >/dev/null && secret-tool clear service "$SECRET_SERVICE" || true
    else
        say "Kept $CONF and the password in GNOME Keyring (use --purge to remove them)"
    fi
    say "Done. Restart GNOME Shell or log out to drop the tile."
}

do_install() {
    # Soft checks: warn, don't stop.
    command -v forcepoint-client >/dev/null \
        || warn "forcepoint-client not found in PATH. Install the official Forcepoint VPN Client for Linux."
    command -v secret-tool >/dev/null \
        || warn "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch)."
    command -v gnome-shell >/dev/null \
        && say "Found $(gnome-shell --version)"

    say "Installing helper to $HELPER (root-owned)"
    sudo install -o root -g root -m 755 "$HERE/helper/fp-vpn" "$HELPER"

    say "Installing sudo rule for user '$USER_NAME' to $SUDOERS"
    local tmp
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' RETURN
    sed "/^#/!s/YOURUSER/$USER_NAME/" "$HERE/helper/fp-vpn.sudoers" >"$tmp"
    sudo visudo -cf "$tmp" >/dev/null || die "generated sudo rule failed visudo check; nothing installed"
    sudo install -o root -g root -m 440 "$tmp" "$SUDOERS"

    say "Installing extension to $EXT_DEST"
    mkdir -p "$EXT_DEST"
    cp "$EXT_SRC"/metadata.json "$EXT_SRC"/extension.js "$EXT_SRC"/prefs.js "$EXT_DEST"/

    if [[ -f $CONF ]]; then
        say "Keeping existing $CONF"
    else
        say "Creating $CONF from the example (edit it in Settings)"
        mkdir -p "$(dirname "$CONF")"
        install -m 600 "$HERE/fp-vpn.conf.example" "$CONF"
    fi

    gnome-extensions enable "$UUID" 2>/dev/null || true

    cat <<MSG

Installed. Next steps:
  1. Reload GNOME Shell
       X11:     Alt+F2, type r, Enter
       Wayland: log out and back in
  2. Enable it (if not already):  gnome-extensions enable $UUID
  3. Open Settings from the arrow on the "Forcepoint VPN" tile,
     enter gateway, port, username and password, and Save.
  4. Click the tile to connect.  Log: /var/log/fp-vpn.log
MSG
}

case "${1:-}" in
    "")           do_install ;;
    --uninstall)  do_uninstall no ;;
    --purge)      do_uninstall yes ;;
    -h|--help)    sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//' ;;
    *)            die "unknown option '$1' (see --help)" ;;
esac

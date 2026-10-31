#!/bin/sh
# Runs after install and upgrade (.deb and .rpm).
set -e

getent group fp-vpn >/dev/null || groupadd --system fp-vpn

SUDOERS=/etc/sudoers.d/forcepoint-vpn-toggle
chown root:root "$SUDOERS"
chmod 0440 "$SUDOERS"
if ! visudo -cf "$SUDOERS" >/dev/null 2>&1; then
    echo "forcepoint-vpn-gnome-toggle: sudo rule failed visudo check, removing it" >&2
    rm -f "$SUDOERS"
fi

# Add the user who ran "sudo apt/dnf install", if any.
added=""
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ] && id "$SUDO_USER" >/dev/null 2>&1; then
    if ! id -nG "$SUDO_USER" | tr ' ' '\n' | grep -qx fp-vpn; then
        usermod -aG fp-vpn "$SUDO_USER" && added="$SUDO_USER"
    fi
fi

cat <<MSG

Forcepoint VPN Toggle installed.
MSG
if [ -n "$added" ]; then
    echo "  User '$added' was added to the fp-vpn group."
else
    echo "  Add each user who should use it:  sudo usermod -aG fp-vpn <user>"
fi
cat <<MSG
  Then, as that user:
    1. Log out and back in (for the group and the extension).
    2. gnome-extensions enable forcepoint-vpn@local
    3. Open Settings from the Forcepoint VPN tile and enter your details.

MSG
exit 0

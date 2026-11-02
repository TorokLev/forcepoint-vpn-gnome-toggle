#!/bin/sh
# Runs after install and upgrade (.deb and .rpm).
#   deb: $1 = configure, $2 = previously installed version ("" on first install)
#   rpm: $1 = 1 on first install, 2+ on upgrade
set -e

UUID=forcepoint-vpn@local

first_install=no
if { [ "$1" = configure ] && [ -z "${2:-}" ]; } || [ "$1" = 1 ]; then
    first_install=yes
fi

getent group fp-vpn >/dev/null || groupadd --system fp-vpn

SUDOERS=/etc/sudoers.d/forcepoint-vpn-toggle
chown root:root "$SUDOERS"
chmod 0440 "$SUDOERS"
if ! visudo -cf "$SUDOERS" >/dev/null 2>&1; then
    echo "forcepoint-vpn-gnome-toggle: sudo rule failed visudo check, removing it" >&2
    rm -f "$SUDOERS"
fi

# The desktop user who started the install: "sudo apt/dnf install" sets
# SUDO_USER, a graphical installer (pkexec) sets PKEXEC_UID.
target=""
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    target=$SUDO_USER
elif [ -n "${PKEXEC_UID:-}" ] && [ "$PKEXEC_UID" != 0 ]; then
    target=$(id -nu "$PKEXEC_UID" 2>/dev/null || true)
fi
if [ -n "$target" ] && ! id "$target" >/dev/null 2>&1; then
    target=""
fi

# Add the user to the group. usermod only handles local accounts;
# gpasswd also works for directory accounts (SSSD, Entra ID, LDAP).
added=""
if [ -n "$target" ]; then
    if id -nG "$target" | tr ' ' '\n' | grep -qx fp-vpn \
       || getent group fp-vpn | cut -d: -f4 | tr ',' '\n' | grep -qx "$target"; then
        added=already
    elif usermod -aG fp-vpn "$target" 2>/dev/null \
         || gpasswd -a "$target" fp-vpn >/dev/null 2>&1; then
        added=yes
    fi
fi

# Turn the extension on for that user, first install only (an upgrade must
# not re-enable it if the user switched it off). Needs their session bus.
enabled=no
if [ "$first_install" = yes ] && [ -n "$target" ]; then
    uid=$(id -u "$target")
    bus="/run/user/$uid/bus"
    if [ -S "$bus" ] && command -v gsettings >/dev/null 2>&1; then
        as_user() {
            runuser -u "$target" -- env \
                DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
                XDG_RUNTIME_DIR="/run/user/$uid" "$@"
        }
        current=$(as_user gsettings get org.gnome.shell enabled-extensions 2>/dev/null || true)
        case "$current" in
            *"'$UUID'"*)
                enabled=yes ;;
            "" ) ;;
            "@as []"|"[]")
                as_user gsettings set org.gnome.shell enabled-extensions "['$UUID']" \
                    2>/dev/null && enabled=yes ;;
            *)
                new=$(printf '%s' "$current" | sed "s/]\$/, '$UUID']/")
                as_user gsettings set org.gnome.shell enabled-extensions "$new" \
                    2>/dev/null && enabled=yes ;;
        esac
        # Also lift it from the disabled list, like "gnome-extensions enable" does.
        disabled=$(as_user gsettings get org.gnome.shell disabled-extensions 2>/dev/null || true)
        case "$disabled" in
            *"'$UUID'"*)
                new=$(printf '%s' "$disabled" | sed -e "s/'$UUID', //; s/, '$UUID'//; s/'$UUID'//; s/^\[\]\$/@as []/")
                as_user gsettings set org.gnome.shell disabled-extensions "$new" 2>/dev/null || true ;;
        esac
    fi
fi

echo
echo "Forcepoint VPN Toggle installed."
case "$added" in
    yes)     echo "  User '$target' was added to the fp-vpn group." ;;
    already) echo "  User '$target' is in the fp-vpn group." ;;
    *)       echo "  Add each user who should use it:  sudo gpasswd -a <user> fp-vpn" ;;
esac
[ "$enabled" = yes ] && echo "  The extension was enabled for '$target'."
echo
echo "  Next:"
if [ "$added" = yes ]; then
    echo "    - Reboot (so the new group is active in your desktop session)."
else
    echo "    - Log out and back in."
fi
if [ "$enabled" != yes ]; then
    echo "    - gnome-extensions enable $UUID"
fi
echo "    - Open Settings from the Forcepoint VPN tile and enter your details."
echo
exit 0

#!/bin/sh
# Runs after install and upgrade (.deb and .rpm).
#   deb: $1 = configure, $2 = previously installed version ("" on first install)
#   rpm: $1 = 1 on first install, 2+ on upgrade
set -e

UUID=forcepoint-vpn@local
GROUP_RULE=/etc/sudoers.d/forcepoint-vpn-toggle
USER_RULE=/etc/sudoers.d/forcepoint-vpn-toggle-users
HELPER=/usr/bin/fp-vpn

first_install=no
if { [ "$1" = configure ] && [ -z "${2:-}" ]; } || [ "$1" = 1 ]; then
    first_install=yes
fi

# --- group and group sudo rule (for users added later) ----------------------
getent group fp-vpn >/dev/null || groupadd --system fp-vpn
chown root:root "$GROUP_RULE"
chmod 0440 "$GROUP_RULE"
if ! visudo -cf "$GROUP_RULE" >/dev/null 2>&1; then
    echo "forcepoint-vpn-gnome-toggle: sudo rule failed visudo check, removing it" >&2
    rm -f "$GROUP_RULE"
fi

# --- who is installing ------------------------------------------------------
# "sudo apt/dnf install" sets SUDO_USER, a graphical installer sets PKEXEC_UID.
target=""
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    target=$SUDO_USER
elif [ -n "${PKEXEC_UID:-}" ] && [ "$PKEXEC_UID" != 0 ]; then
    target=$(id -nu "$PKEXEC_UID" 2>/dev/null || true)
fi
if [ -n "$target" ] && ! id "$target" >/dev/null 2>&1; then
    target=""
fi

# --- group membership (usermod: local accounts; gpasswd: also SSSD/Entra/LDAP)
if [ -n "$target" ] && ! getent group fp-vpn | cut -d: -f4 | tr ',' '\n' | grep -qx "$target"; then
    usermod -aG fp-vpn "$target" 2>/dev/null || gpasswd -a "$target" fp-vpn >/dev/null 2>&1 || true
fi

# --- per-user sudo rule: works at once, unlike a new group (needs a new login)
user_rule=no
if [ -n "$target" ] && printf '%s' "$target" | grep -Eq '^[A-Za-z0-9._-]+$'; then
    if ! grep -qs "^$target " "$USER_RULE"; then
        tmp=$(mktemp)
        { [ -f "$USER_RULE" ] && cat "$USER_RULE" || echo "# Users added by the forcepoint-vpn-gnome-toggle package installer."; } >"$tmp"
        echo "$target ALL=(root) NOPASSWD: $HELPER connect, $HELPER disconnect" >>"$tmp"
        if visudo -cf "$tmp" >/dev/null 2>&1; then
            install -o root -g root -m 0440 "$tmp" "$USER_RULE"
        fi
        rm -f "$tmp"
    fi
    grep -qs "^$target " "$USER_RULE" && user_rule=yes
fi

# --- GNOME settings of the installing user (needs their running session) -----
ext_enabled=unknown      # yes | no | unknown (no session)
switch_on=unknown        # yes | no | unknown
switch_turned_on=no
if [ -n "$target" ]; then
    uid=$(id -u "$target")
    bus="/run/user/$uid/bus"
    if [ -S "$bus" ] && command -v gsettings >/dev/null 2>&1; then
        as_user() {
            runuser -u "$target" -- env \
                DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
                XDG_RUNTIME_DIR="/run/user/$uid" "$@"
        }
        gs_get() { as_user gsettings get org.gnome.shell "$1" 2>/dev/null || true; }
        gs_set() { as_user gsettings set org.gnome.shell "$1" "$2" 2>/dev/null; }

        enabled=$(gs_get enabled-extensions)
        disabled=$(gs_get disabled-extensions)
        users_off=$(gs_get disable-user-extensions)

        if [ "$first_install" = yes ]; then
            # Enable our extension.
            case "$enabled" in
                *"'$UUID'"*) ;;
                ""|"@as []"|"[]") gs_set enabled-extensions "['$UUID']" || true ;;
                *) gs_set enabled-extensions "$(printf '%s' "$enabled" | sed "s/]\$/, '$UUID']/")" || true ;;
            esac
            case "$disabled" in
                *"'$UUID'"*)
                    gs_set disabled-extensions "$(printf '%s' "$disabled" | sed -e "s/'$UUID', //; s/, '$UUID'//; s/'$UUID'//; s/^\[\]\$/@as []/")" || true ;;
            esac
            # The global "Use Extensions" switch: while off, GNOME ignores every
            # enabled extension. Installing an extension means you want them on.
            if [ "$users_off" = true ]; then
                gs_set disable-user-extensions false && switch_turned_on=yes
            fi
            enabled=$(gs_get enabled-extensions)
            disabled=$(gs_get disabled-extensions)
            users_off=$(gs_get disable-user-extensions)
        fi

        case "$enabled" in *"'$UUID'"*) ext_enabled=yes ;; *) ext_enabled=no ;; esac
        case "$disabled" in *"'$UUID'"*) ext_enabled=no ;; esac
        [ "$users_off" = true ] && switch_on=no || switch_on=yes

        # On an upgrade we never change settings, but say what's off.
        if [ "$first_install" = no ] && { [ "$ext_enabled" = no ] || [ "$switch_on" = no ]; } \
           && command -v notify-send >/dev/null 2>&1; then
            if [ "$switch_on" = no ]; then
                msg="GNOME extensions are switched off. Turn on \"Use Extensions\" in the Extensions app, or run: gsettings set org.gnome.shell disable-user-extensions false"
            else
                msg="The extension is switched off. To use it, run: gnome-extensions enable $UUID"
            fi
            as_user notify-send --app-name="Forcepoint VPN Toggle" --icon=network-vpn-symbolic \
                "Forcepoint VPN Toggle updated" "$msg" 2>/dev/null || true
        fi
    fi
fi

# --- summary ----------------------------------------------------------------
echo
echo "Forcepoint VPN Toggle installed."
[ "$user_rule" = yes ] && echo "  '$target' can connect without a sudo password (works right away)."
[ "$switch_turned_on" = yes ] && echo "  GNOME extensions were switched off globally; they are on again."
[ "$first_install" = yes ] && [ "$ext_enabled" = yes ] && echo "  The extension was enabled for '$target'."
echo
echo "  Next:"
if [ "$first_install" = yes ]; then
    if [ "${XDG_SESSION_TYPE:-}" = x11 ] || [ "$(loginctl show-session "$(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$target" '$3==u{print $1; exit}')" -p Type --value 2>/dev/null)" = x11 ]; then
        echo "    - Restart GNOME Shell: Alt+F2, type r, Enter (or log out and back in)."
    else
        echo "    - Log out and back in, so GNOME Shell finds the new extension."
    fi
fi
[ "$ext_enabled" = no ] && echo "    - Enable it:  gnome-extensions enable $UUID"
[ "$switch_on" = no ] && echo "    - Turn on GNOME extensions:  gsettings set org.gnome.shell disable-user-extensions false"
[ "$ext_enabled" = unknown ] && echo "    - If the tile is missing after login:  gnome-extensions enable $UUID"
[ "$user_rule" = no ] && echo "    - Allow users:  sudo gpasswd -a <user> fp-vpn  (then they log in again)"
echo "    - Open Settings from the Forcepoint VPN tile and enter your details."
echo
exit 0

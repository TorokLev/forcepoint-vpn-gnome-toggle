#!/bin/sh
# deb: $1 = remove|purge|upgrade|...   rpm: $1 = 0 (erase) or 1 (upgrade)
case "$1" in
    remove|purge|0)
        # Created by postinstall, not owned by the package: remove it with the helper.
        rm -f /etc/sudoers.d/forcepoint-vpn-toggle-users
        ;;
esac
case "$1" in
    purge|0)
        rm -f /run/fp-vpn.pid /run/fp-vpn.state /run/fp-vpn.cert /var/log/fp-vpn.log
        getent group fp-vpn >/dev/null && groupdel fp-vpn || true
        ;;
esac
exit 0

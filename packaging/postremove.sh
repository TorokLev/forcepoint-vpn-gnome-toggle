#!/bin/sh
# deb: $1 = remove|purge|upgrade|...   rpm: $1 = 0 (erase) or 1 (upgrade)
case "$1" in
    purge|0)
        rm -f /run/fp-vpn.pid /run/fp-vpn.state /var/log/fp-vpn.log
        getent group fp-vpn >/dev/null && groupdel fp-vpn || true
        ;;
esac
exit 0

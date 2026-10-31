#!/bin/sh
# Disconnect before the helper is removed (not on upgrade).
# deb: $1 = remove|upgrade|...   rpm: $1 = 0 (erase) or 1 (upgrade)
case "$1" in
    remove|0) [ -x /usr/bin/fp-vpn ] && /usr/bin/fp-vpn disconnect >/dev/null 2>&1 || true ;;
esac
exit 0

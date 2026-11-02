# Changelog

## [1.1.0] - 2026-11-02

- Package install now enables the extension for the user who installed it (first install only; upgrades never re-enable it).
- Package install adds directory accounts (SSSD, Entra ID, LDAP) to the `fp-vpn` group via `gpasswd` when `usermod` can't.
- Works when installed from a graphical installer (App Center), not only `sudo apt`/`dnf`.

## [1.0.0] - 2026-11-01

First release.

- Quick Settings tile to connect and disconnect, with connecting / connected / disconnected states.
- Settings window for gateway, port, username, password, client config folder and DNS resolver.
- Password stored in GNOME Keyring and sent to the client only after it asks for it.
- Stops after a wrong password (no retry) and after 60 s without a completed login.
- `.deb` and `.rpm` packages with a group-based sudo rule, plus `install.sh` for other systems.

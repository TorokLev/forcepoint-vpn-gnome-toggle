## [1.1.0] - 2026-11-02

- Package install now enables the extension for the user who installed it (first install only; upgrades never re-enable it).
- Package install adds directory accounts (SSSD, Entra ID, LDAP) to the `fp-vpn` group via `gpasswd` when `usermod` can't.
- Works when installed from a graphical installer (App Center), not only `sudo apt`/`dnf`.
- Tile shows the VPN's IPv4 address while connected; the tile menu shows the address (click to copy) and the gateway.
- First connection to a gateway works from the GUI: the gateway certificate is accepted only if its SHA-256 fingerprint matches the one trusted in Settings. An unknown certificate stops the connection and can be reviewed and trusted in Settings with one click.
- Helper passes `-c` only when the client's config file exists, so first connections no longer fail with "Failed to read config".


## [1.1.0] - 2026-11-02

- Package install now enables the extension for the user who installed it (first install only; upgrades never re-enable it).
- Package install adds directory accounts (SSSD, Entra ID, LDAP) to the `fp-vpn` group via `gpasswd` when `usermod` can't.
- Works when installed from a graphical installer (App Center), not only `sudo apt`/`dnf`.
- Tile shows the VPN's IPv4 address while connected; the tile menu shows the address (click to copy) and the gateway.
- First connection to a gateway works from the GUI: the gateway certificate is accepted only if its SHA-256 fingerprint matches the one trusted in Settings. An unknown certificate stops the connection and can be reviewed and trusted in Settings with one click.
- Helper passes `-c` only when the client's config file exists, so first connections no longer fail with "Failed to read config".

## [1.2.0] - 2026-11-03

- New setting **Keep local network reachable** (on by default): while connected, replies from this machine's LAN address to its local network leave through the LAN interface, so SSH, Jupyter and other incoming connections from the local network keep working even when the VPN pushes routes that overlap the local network (e.g. both use 192.168.25.0/24). Connections into the VPN are not affected. Rules follow network changes and are removed on disconnect.

## [1.2.1] - 2026-11-04

- Fix: the status changed to "connected" as soon as the password was sent. It now waits for the gateway to accept the password and for the tunnel to be configured (`Authentication successful`, then state `CONFIGURED`).
- After a successful login the helper never stops the client because of the login timeout.
- Package install: the installing user gets a sudo rule by name, so the tile works right away without a reboot (the `fp-vpn` group is still used for other users).
- Package install: on a first install, GNOME's global "Use Extensions" switch is turned back on if it was off. On upgrades settings are never changed; instead a desktop notification explains what is switched off and how to turn it on.


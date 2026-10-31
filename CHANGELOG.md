# Changelog

## [1.0.0] - 2026-11-01

First release.

- Quick Settings tile to connect and disconnect, with connecting / connected / disconnected states.
- Settings window for gateway, port, username, password, client config folder and DNS resolver.
- Password stored in GNOME Keyring and sent to the client only after it asks for it.
- Stops after a wrong password (no retry) and after 60 s without a completed login.
- `.deb` and `.rpm` packages with a group-based sudo rule, plus `install.sh` for other systems.

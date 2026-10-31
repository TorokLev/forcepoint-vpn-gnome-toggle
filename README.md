# Forcepoint VPN Toggle for GNOME

One-click connect and disconnect for the **Forcepoint VPN Client for Linux** from GNOME's Quick Settings menu, with a settings window and the password kept in GNOME Keyring.

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Forcepoint. It is a thin wrapper around the official `forcepoint-client` command, which you must install separately from Forcepoint. Nothing from Forcepoint is included here.

<!-- Add your own screenshots to docs/screenshots/ and uncomment:
![Quick Settings tile](docs/screenshots/tile.png)
![Settings window](docs/screenshots/settings.png)
-->

## Features

- A **Forcepoint VPN** tile in Quick Settings: click to connect or disconnect, with a lock icon in the top bar while connected.
- A **Settings** window (arrow on the tile, or the Extensions app) for gateway, port, username, password, client config folder and DNS resolver.
- The password lives in **GNOME Keyring**, never in a file or on a command line.
- Works on **GNOME Shell 45–49**, X11 and Wayland.

## Requirements

- GNOME Shell 45, 46, 47, 48 or 49 (`gnome-shell --version`)
- The official Forcepoint VPN Client for Linux, with `forcepoint-client` in your `PATH`, and a gateway you can already connect to from a terminal
- `secret-tool`: package `libsecret-tools` on Debian/Ubuntu, `libsecret` on Fedora and Arch
- `sudo`

Make sure a manual connection works first, for example:

```bash
sudo forcepoint-client <gateway> -p <port> -u <username> \
     -c ~/.config/forcepoint/sslvpn/<gateway>_<port> -V --resolver /usr/bin/resolvectl
```

The first manual connection also stores the gateway certificate in that `-c` folder, which the extension relies on.

## Install

Pick **one** of the two methods. If you switch, uninstall the other first.

### Option A: package (Ubuntu/Debian, Fedora/RHEL)

Download the package from the [latest release](https://github.com/TorokLev/forcepoint-vpn-gnome-toggle/releases/latest), then:

```bash
sudo apt install ./forcepoint-vpn-gnome-toggle_*_all.deb        # Ubuntu / Debian
sudo dnf install ./forcepoint-vpn-gnome-toggle-*.noarch.rpm     # Fedora / RHEL
```

The package installs the helper to `/usr/bin/fp-vpn`, the extension system-wide, and a sudo rule for members of the **`fp-vpn`** group. The user who ran the install command is added to that group automatically. To allow other users:

```bash
sudo usermod -aG fp-vpn <user>
```

Then log out and back in (needed for the new group and the extension) and enable it:

```bash
gnome-extensions enable forcepoint-vpn@local
```

Remove with `sudo apt remove forcepoint-vpn-gnome-toggle` (or `apt purge` to also remove the group and log), or `sudo dnf remove forcepoint-vpn-gnome-toggle`. Your settings and the password in GNOME Keyring are kept.

### Option B: install script (any distro)

```bash
git clone https://github.com/TorokLev/forcepoint-vpn-gnome-toggle.git
cd forcepoint-vpn-gnome-toggle
./install.sh
```

Run it as your normal user; it asks for your sudo password where root is needed. It installs:

| What | Where |
|---|---|
| Root helper script | `/usr/local/bin/fp-vpn` |
| Sudo rule (only for that script, only for you) | `/etc/sudoers.d/fp-vpn` |
| GNOME extension | `~/.local/share/gnome-shell/extensions/forcepoint-vpn@local/` |
| Your settings (only if missing) | `~/.config/fp-vpn.conf` |

Then reload GNOME Shell (X11: <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd>; Wayland: log out and back in) and enable it:

```bash
gnome-extensions enable forcepoint-vpn@local
```

## First setup

1. Open the system menu (top-right corner).
2. Click the arrow on the **Forcepoint VPN** tile and choose **Settings**.
3. Enter gateway, port, username and password, then **Save**.
4. Click the tile to connect.

## Command line

The helper also works on its own:

```bash
sudo -n fp-vpn connect      # asks for the password if run in a terminal
fp-vpn status               # connected / disconnected (no sudo needed)
sudo -n fp-vpn disconnect

# connect using the password stored in GNOME Keyring
secret-tool lookup service forcepoint-vpn | sudo -n fp-vpn connect
```

## How it works

```
Quick Settings tile (runs as you)
  ├─ reads the password:      secret-tool lookup service forcepoint-vpn
  └─ runs:                    sudo -n /usr/local/bin/fp-vpn connect   (password on stdin)

/usr/local/bin/fp-vpn (runs as root)
  ├─ reads and validates      ~/.config/fp-vpn.conf of the user who called sudo
  └─ starts forcepoint-client in its own session, feeding the password
     through a private FIFO, and records the PID in /run/fp-vpn.pid
```

`forcepoint-client` asks for the password interactively on stdin. The helper gives it a pipe instead of a terminal, writes the password once, and keeps the pipe open while the client runs. Disconnect sends `SIGTERM` to the whole session.

## Security notes

The sudo rule lets your user run one command as root without a password, so the helper is written defensively:

- The rule allows exactly `/usr/local/bin/fp-vpn connect` and `.../fp-vpn disconnect`, nothing else.
- The helper is owned by root and not writable by you. Don't replace it with a symlink into your home folder.
- The config file is **parsed, not sourced**: unknown keys are rejected and no line is ever executed.
- Every value is validated before it reaches the root command line: gateway (IP or hostname characters only), port (1–65535), username (letters, digits, `. _ @ \ -`), config folder (must resolve inside your home), resolver (fixed allow-list).
- The password is passed over stdin, never as an argument or environment variable, so it doesn't show up in `ps`. It's stored in GNOME Keyring, and the config file is created with mode `600`.

If you find a weakness, please open an issue.

## Troubleshooting

**`Extension "forcepoint-vpn@local" does not exist`**: GNOME Shell hasn't rescanned yet. Reload it (see Install) and enable again.

**Tile appears but nothing happens**: watch the helper log while clicking:
```bash
tail -f /var/log/fp-vpn.log
```

**Notification "a password is required"**: the sudo rule doesn't match. Package install: check `id` lists the `fp-vpn` group (log out and in after adding it). Install script: check `/etc/sudoers.d/fp-vpn` has your user name. Test with `sudo -k; sudo -n -l fp-vpn connect`.

**Notification "No password in GNOME Keyring"**: set it in Settings, or run `secret-tool store --label="Forcepoint VPN" service forcepoint-vpn`.

**`Failed to get terminal attributes: Inappropriate ioctl for device` in the log**: harmless. The client tries to hide password input and there is no terminal; the connection continues.

**Extension errors**:
```bash
gnome-extensions info forcepoint-vpn@local
journalctl -b -o cat /usr/bin/gnome-shell | grep -i -A8 forcepoint
```

**Stopped loading after a GNOME upgrade**: add the new major version to `shell-version` in `metadata.json`, rerun `./install.sh`, and reload GNOME Shell.

## Limitations

- Password login only. One-time codes, push approvals and other prompts are not handled yet.
- "Connected" means the client completed the login. It doesn't test that internal hosts are reachable.
- One gateway at a time.

## Update / uninstall

Package: install the newer package the same way; `apt`/`dnf` upgrade it in place.

Install script:

```bash
git pull && ./install.sh          # update
./install.sh --uninstall          # remove; keeps your settings and password
./install.sh --purge              # remove everything, including settings and password
```

## Releasing (maintainers)

1. Update `CHANGELOG.md` with a `## [X.Y.Z] - date` section and `version-name` in `metadata.json`.
2. Commit, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
3. GitHub Actions builds the `.deb`, `.rpm`, extension zip and `SHA256SUMS`, and publishes the release with the changelog section as notes.

To build packages locally, install [nFPM](https://nfpm.goreleaser.com/) and run:

```bash
VERSION=1.0.0 nfpm package --config packaging/nfpm.yaml --packager deb --target dist/
```

## License

[GPL-2.0-or-later](LICENSE), like GNOME Shell itself.

Forcepoint is a trademark of its respective owner. It is used here only to describe what this tool works with.

// SPDX-License-Identifier: Apache-2.0
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// install.sh puts the helper in /usr/local/bin, the .deb/.rpm in /usr/bin.
const HELPER = ['/usr/local/bin/fp-vpn', '/usr/bin/fp-vpn']
    .find(p => GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE)) ?? '/usr/bin/fp-vpn';
const POLL_SECONDS = 5;
const SECRET_SERVICE = 'forcepoint-vpn';
const CONF_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'fp-vpn.conf']);

// Run a command without blocking the shell; resolves with {ok, stdout, stderr}.
// If input is given, it is written to the command's stdin.
function run(argv, input = null) {
    return new Promise(resolve => {
        try {
            let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            if (input !== null)
                flags |= Gio.SubprocessFlags.STDIN_PIPE;
            const proc = Gio.Subprocess.new(argv, flags);
            proc.communicate_utf8_async(input, null, (p, res) => {
                try {
                    const [, out, err] = p.communicate_utf8_finish(res);
                    resolve({ok: p.get_successful(), stdout: out ?? '', stderr: err ?? ''});
                } catch (e) {
                    resolve({ok: false, stdout: '', stderr: e.message});
                }
            });
        } catch (e) {
            resolve({ok: false, stdout: '', stderr: e.message});
        }
    });
}

// Gateway and port from ~/.config/fp-vpn.conf, for display only.
function readGateway() {
    try {
        const [, bytes] = GLib.file_get_contents(CONF_PATH);
        const conf = {};
        for (const line of new TextDecoder().decode(bytes).split('\n')) {
            const m = line.match(/^\s*(GATEWAY|PORT)\s*=\s*(\S+)\s*$/);
            if (m)
                conf[m[1]] = m[2];
        }
        return conf.GATEWAY ? `${conf.GATEWAY}:${conf.PORT ?? '443'}` : null;
    } catch (e) {
        return null;
    }
}

// IPv4 addresses on tunnel interfaces, e.g. [{ifname: 'tun0', ip: '10.1.2.3', prefix: 24}].
async function tunnelAddresses() {
    const r = await run(['ip', '-j', '-4', 'addr', 'show', 'type', 'tun']);
    if (!r.ok)
        return [];
    try {
        return JSON.parse(r.stdout).flatMap(link =>
            (link.addr_info ?? [])
                .filter(a => a.family === 'inet')
                .map(a => ({ifname: link.ifname, ip: a.local, prefix: a.prefixlen})));
    } catch (e) {
        return [];
    }
}

const VpnToggle = GObject.registerClass(
class VpnToggle extends QuickMenuToggle {
    _init(indicator, extension) {
        super._init({
            title: 'Forcepoint VPN',
            iconName: 'network-vpn-symbolic',
            toggleMode: false,
        });
        this._indicator = indicator;

        // Arrow on the tile opens this menu.
        this.menu.setHeader('network-vpn-symbolic', 'Forcepoint VPN');

        // VPN address; click copies it.
        this._ip = null;
        this._addressItem = new PopupMenu.PopupMenuItem('');
        this._addressItem.connect('activate', () => {
            if (!this._ip)
                return;
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._ip);
            Main.notify('Forcepoint VPN', `Copied ${this._ip}`);
        });
        this.menu.addMenuItem(this._addressItem);
        this._addressSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._addressSeparator);

        this._certItem = this.menu.addAction('Review gateway certificate…',
            () => extension.openPreferences());
        this._certItem.visible = false;

        this.menu.addAction('Settings', () => extension.openPreferences());
        this._showAddress(false, []);

        this._busy = false;
        this.connect('clicked', () => this._onClicked());
    }

    async _onClicked() {
        if (this._busy)
            return;
        this._busy = true;

        const action = this.checked ? 'disconnect' : 'connect';
        this.subtitle = action === 'connect' ? 'Connecting…' : 'Disconnecting…';

        let input = null;
        if (action === 'connect') {
            const pw = await run(['secret-tool', 'lookup', 'service', SECRET_SERVICE]);
            if (!pw.ok || pw.stdout === '') {
                Main.notifyError('Forcepoint VPN',
                    `No password in GNOME Keyring. Store it with: secret-tool store --label="Forcepoint VPN" service ${SECRET_SERVICE}`);
                this._finish(0);
                return;
            }
            input = `${pw.stdout.replace(/\n$/, '')}\n`;
        }

        const r = await run(['sudo', '-n', HELPER, action], input);
        input = null;
        if (!r.ok)
            Main.notifyError('Forcepoint VPN', r.stderr.trim() || `${action} failed`);

        // Give the client a moment to come up or go down, then re-check.
        this._finish(3);
    }

    _finish(delaySeconds) {
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => {
            this._busy = false;
            this._indicator.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // state: 'connected' | 'connecting' | 'disconnected' | 'certificate'
    // addrs: tunnel IPv4 addresses (only looked up while connected)
    setState(state, addrs = [], gateway = null) {
        // While connecting the tile is "on", so a click cancels.
        this.checked = state === 'connected' || state === 'connecting';
        this._certItem.visible = state === 'certificate';
        this._ip = state === 'connected' && addrs.length ? addrs[0].ip : null;

        if (!this._busy) {
            if (state === 'connected')
                this.subtitle = this._ip ?? 'No IPv4 address';
            else if (state === 'connecting')
                this.subtitle = 'Connecting…';
            else if (state === 'certificate')
                this.subtitle = 'Certificate not trusted';
            else
                this.subtitle = 'Disconnected';
        }

        this.menu.setHeader('network-vpn-symbolic', 'Forcepoint VPN',
            gateway ? `Gateway ${gateway}` : '');
        this._showAddress(state === 'connected', addrs);
    }

    _showAddress(connected, addrs) {
        this._addressItem.visible = connected;
        this._addressSeparator.visible = connected;
        if (!connected)
            return;
        this._addressItem.label.text = addrs.length
            ? addrs.map(a => `Address  ${a.ip}/${a.prefix} (${a.ifname})`).join('\n')
            : 'No IPv4 address on the tunnel yet';
        this._addressItem.reactive = addrs.length > 0;
    }
});

const VpnIndicator = GObject.registerClass(
class VpnIndicator extends SystemIndicator {
    _init(extension) {
        super._init();
        this._icon = this._addIndicator();
        this._icon.iconName = 'network-vpn-symbolic';
        this._icon.visible = false;

        this._toggle = new VpnToggle(this, extension);
        this.quickSettingsItems.push(this._toggle);

        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this.refresh();
    }

    async refresh() {
        // "status" needs no root, so no sudo here.
        const r = await run([HELPER, 'status']);
        const out = r.stdout.trim();
        const state = r.ok && ['connected', 'connecting', 'certificate'].includes(out) ? out : 'disconnected';
        const addrs = state === 'connected' ? await tunnelAddresses() : [];
        if (!this._toggle)
            return; // destroyed while waiting
        this._icon.visible = state === 'connected';
        this._toggle.setState(state, addrs, readGateway());

        // Tell the user once per attempt; the tile keeps showing it.
        if (state === 'certificate' && this._lastState !== 'certificate') {
            Main.notify('Forcepoint VPN',
                'The gateway presented a certificate that is not trusted yet. ' +
                'Open the tile menu → Review gateway certificate.');
        }
        this._lastState = state;
    }

    destroy() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this.quickSettingsItems.forEach(item => item.destroy());
        this._toggle = null;
        super.destroy();
    }
});

export default class ForcepointVpnExtension extends Extension {
    enable() {
        this._indicator = new VpnIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

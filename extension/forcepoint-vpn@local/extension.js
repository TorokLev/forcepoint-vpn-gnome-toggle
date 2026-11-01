// SPDX-License-Identifier: Apache-2.0
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// install.sh puts the helper in /usr/local/bin, the .deb/.rpm in /usr/bin.
const HELPER = ['/usr/local/bin/fp-vpn', '/usr/bin/fp-vpn']
    .find(p => GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE)) ?? '/usr/bin/fp-vpn';
const POLL_SECONDS = 5;
const SECRET_SERVICE = 'forcepoint-vpn';

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
        this.menu.addAction('Settings', () => extension.openPreferences());

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

    // state: 'connected' | 'connecting' | 'disconnected'
    setState(state) {
        // While connecting the tile is "on", so a click cancels.
        this.checked = state !== 'disconnected';
        if (!this._busy) {
            this.subtitle = {
                connected: 'Connected',
                connecting: 'Connecting…',
            }[state] ?? 'Disconnected';
        }
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
        const state = r.ok && ['connected', 'connecting'].includes(out) ? out : 'disconnected';
        if (!this._toggle)
            return; // destroyed while waiting
        this._icon.visible = state === 'connected';
        this._toggle.setState(state);
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

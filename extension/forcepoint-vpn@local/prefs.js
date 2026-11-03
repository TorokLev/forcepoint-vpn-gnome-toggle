// SPDX-License-Identifier: Apache-2.0
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The same file /usr/local/bin/fp-vpn reads.
const CONF_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'fp-vpn.conf']);
const SECRET_SERVICE = 'forcepoint-vpn';
const KEYS = ['GATEWAY', 'PORT', 'USERNAME', 'CONF_DIR', 'RESOLVER', 'TRUSTED_SHA256', 'KEEP_LAN'];
const CERTFILE = '/run/fp-vpn.cert';
const RESOLVERS = ['/usr/bin/resolvectl', '/usr/sbin/resolvconf', 'none'];

// Same rules as the root script, so mistakes are caught here first.
const VALID = {
    GATEWAY: v => /^[A-Za-z0-9.-]{1,253}$/.test(v),
    PORT: v => /^[0-9]{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535,
    USERNAME: v => /^[A-Za-z0-9._@\\-]{1,64}$/.test(v),
    TRUSTED_SHA256: v => v === '' || /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v),
};

// Accept fingerprints pasted with or without colons, any case.
function normalizeFingerprint(text) {
    const hex = text.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length !== 64)
        return text.trim().toUpperCase();
    return hex.match(/../g).join(':');
}

// The untrusted certificate the helper stopped at, if any: {endpoint, fingerprint}.
function readPendingCert() {
    try {
        const [, bytes] = GLib.file_get_contents(CERTFILE);
        const [endpoint, fingerprint] = new TextDecoder().decode(bytes).trim().split(/\s+/);
        return endpoint && fingerprint && fingerprint !== 'unknown' ? {endpoint, fingerprint} : null;
    } catch (e) {
        return null;
    }
}

function readConf() {
    const conf = {GATEWAY: '', PORT: '443', USERNAME: '', CONF_DIR: '', RESOLVER: RESOLVERS[0], TRUSTED_SHA256: '', KEEP_LAN: 'yes'};
    try {
        const [, bytes] = GLib.file_get_contents(CONF_PATH);
        for (const line of new TextDecoder().decode(bytes).split('\n')) {
            const t = line.trim();
            const i = t.indexOf('=');
            if (!t || t.startsWith('#') || i < 0)
                continue;
            const key = t.slice(0, i).trim();
            if (KEYS.includes(key))
                conf[key] = t.slice(i + 1).trim();
        }
    } catch (e) {
        // No file yet: start with defaults.
    }
    return conf;
}

function writeConf(conf) {
    let text = '# Written by the Forcepoint VPN GNOME extension\n';
    for (const key of KEYS) {
        if ((key === 'CONF_DIR' || key === 'TRUSTED_SHA256') && !conf[key])
            continue; // optional, leave out when empty
        text += `${key}=${conf[key]}\n`;
    }
    GLib.mkdir_with_parents(GLib.get_user_config_dir(), 0o700);
    GLib.file_set_contents_full(CONF_PATH, new TextEncoder().encode(text),
        GLib.FileSetContentsFlags.CONSISTENT, 0o600);
}

function runSecretTool(argv, input = null) {
    return new Promise(resolve => {
        try {
            let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            if (input !== null)
                flags |= Gio.SubprocessFlags.STDIN_PIPE;
            const proc = Gio.Subprocess.new(['secret-tool', ...argv], flags);
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

export default class ForcepointVpnPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const conf = readConf();
        window.set_default_size(560, 640);

        const page = new Adw.PreferencesPage({
            title: 'Forcepoint VPN',
            icon_name: 'network-vpn-symbolic',
        });
        window.add(page);

        // Connection
        const connGroup = new Adw.PreferencesGroup({
            title: 'Connection',
            description: `Saved to ${CONF_PATH}`,
        });
        page.add(connGroup);

        const rows = {
            GATEWAY: new Adw.EntryRow({title: 'Gateway (IP or hostname)', text: conf.GATEWAY}),
            PORT: new Adw.EntryRow({title: 'Port', text: conf.PORT}),
            USERNAME: new Adw.EntryRow({title: 'Username', text: conf.USERNAME}),
        };
        for (const [key, row] of Object.entries(rows)) {
            connGroup.add(row);
            row.connect('changed', () => {
                if (VALID[key](row.text))
                    row.remove_css_class('error');
                else
                    row.add_css_class('error');
            });
        }

        // Credentials
        const credGroup = new Adw.PreferencesGroup({
            title: 'Credentials',
            description: 'Stored in GNOME Keyring. Leave empty to keep the current password.',
        });
        page.add(credGroup);
        const pwRow = new Adw.PasswordEntryRow({title: 'Password'});
        credGroup.add(pwRow);

        runSecretTool(['lookup', 'service', SECRET_SERVICE]).then(r => {
            credGroup.description = r.ok && r.stdout !== ''
                ? 'A password is stored in GNOME Keyring. Leave empty to keep it.'
                : 'No password stored yet.';
        });

        // Gateway certificate
        const certGroup = new Adw.PreferencesGroup({
            title: 'Gateway certificate',
            description: 'On the first connection to a gateway, the VPN only accepts its certificate ' +
                'if the SHA-256 fingerprint matches the one below. Compare it with the fingerprint ' +
                'from your IT department before trusting it.',
        });
        page.add(certGroup);

        const fpRow = new Adw.EntryRow({
            title: 'Trusted SHA-256 fingerprint',
            text: conf.TRUSTED_SHA256,
        });
        fpRow.connect('changed', () => {
            if (VALID.TRUSTED_SHA256(normalizeFingerprint(fpRow.text)))
                fpRow.remove_css_class('error');
            else
                fpRow.add_css_class('error');
        });
        certGroup.add(fpRow);

        const pending = readPendingCert();
        let pendingRow = null;
        if (pending) {
            pendingRow = new Adw.ActionRow({
                title: `Not trusted yet: certificate presented by ${pending.endpoint}`,
                subtitle: pending.fingerprint,
                subtitle_selectable: true,
                css_classes: ['property'],
            });
            const trustButton = new Gtk.Button({
                label: 'Trust',
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            trustButton.connect('clicked', () => {
                fpRow.text = pending.fingerprint;
                saveButton.emit('clicked');
                pendingRow.visible = false;
            });
            pendingRow.add_suffix(trustButton);
            certGroup.add(pendingRow);
        }

        // Advanced
        const advGroup = new Adw.PreferencesGroup({title: 'Advanced'});
        page.add(advGroup);

        const confDirRow = new Adw.EntryRow({
            title: 'Client config folder (empty = default)',
            text: conf.CONF_DIR,
        });
        advGroup.add(confDirRow);

        const resolverRow = new Adw.ComboRow({
            title: 'DNS resolver',
            model: Gtk.StringList.new(RESOLVERS),
            selected: Math.max(0, RESOLVERS.indexOf(conf.RESOLVER)),
        });
        advGroup.add(resolverRow);

        const keepLanRow = new Adw.SwitchRow({
            title: 'Keep local network reachable',
            subtitle: 'Lets devices on your local network (SSH, Jupyter, …) keep reaching this ' +
                'machine while the VPN is connected, even if the VPN uses the same addresses.',
            active: conf.KEEP_LAN !== 'no',
        });
        advGroup.add(keepLanRow);

        // Save
        const saveGroup = new Adw.PreferencesGroup();
        page.add(saveGroup);
        const saveButton = new Gtk.Button({
            label: 'Save',
            halign: Gtk.Align.END,
            css_classes: ['suggested-action', 'pill'],
        });
        saveGroup.add(saveButton);

        saveButton.connect('clicked', async () => {
            const next = {
                GATEWAY: rows.GATEWAY.text.trim(),
                PORT: rows.PORT.text.trim(),
                USERNAME: rows.USERNAME.text.trim(),
                CONF_DIR: confDirRow.text.trim(),
                RESOLVER: RESOLVERS[resolverRow.selected],
                TRUSTED_SHA256: normalizeFingerprint(fpRow.text),
                KEEP_LAN: keepLanRow.active ? 'yes' : 'no',
            };
            const bad = Object.keys(VALID).filter(k => !VALID[k](next[k]));
            if (bad.length) {
                const names = {TRUSTED_SHA256: 'fingerprint'};
                window.add_toast(new Adw.Toast({
                    title: `Please check: ${bad.map(k => names[k] ?? k.toLowerCase()).join(', ')}`,
                }));
                return;
            }
            fpRow.text = next.TRUSTED_SHA256;
            if (next.CONF_DIR && !next.CONF_DIR.startsWith(`${GLib.get_home_dir()}/`)) {
                window.add_toast(new Adw.Toast({title: 'Config folder must be inside your home folder'}));
                return;
            }

            try {
                writeConf(next);
            } catch (e) {
                window.add_toast(new Adw.Toast({title: `Could not save settings: ${e.message}`}));
                return;
            }

            if (pwRow.text !== '') {
                const r = await runSecretTool(
                    ['store', '--label=Forcepoint VPN', 'service', SECRET_SERVICE],
                    pwRow.text);
                pwRow.text = '';
                if (!r.ok) {
                    window.add_toast(new Adw.Toast({title: `Settings saved, password not: ${r.stderr.trim()}`}));
                    return;
                }
                credGroup.description = 'A password is stored in GNOME Keyring. Leave empty to keep it.';
            }
            window.add_toast(new Adw.Toast({title: 'Saved. Takes effect on next connect.'}));
        });
    }
}

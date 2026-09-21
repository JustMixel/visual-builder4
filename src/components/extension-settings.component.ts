import * as vscode from 'vscode';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { LocaleManager } from '@i18n';
import { SyntaxColorManager } from '../managers/syntax-color-manager';
import { RecentFileAutosave } from './recent-file-autosave.component';

type SettingsCommand =
	| { command: 'ready' }
	| { command: 'setEnabled'; enabled: boolean }
	| { command: 'setMode'; mode: 'recent' | 'all' }
	| { command: 'setMaxAgeDays'; maxAgeDays: number }
	| { command: 'clearCache' }
	| { command: 'openThemeCreator' }
	| { command: 'openThemesFolder' }
	| { command: 'setTheme'; path: string }
	| { command: 'setLanguage'; id: string }
	| { command: 'openLanguagesFolder' }
	| { command: 'importLanguage' }
	| { command: 'selectFolder' }
	| { command: 'selectVersion' }
	| { command: 'selectGameFolder' }
	| { command: 'selectLanguage' }
	| { command: 'openLibrary' }
	| { command: 'searchOpcodes' }
	| { command: 'mergeCamera' }
	| { command: 'expandOpcode' }
	| { command: 'insertCoordinates' }
	| { command: 'insertAngle' }
	| { command: 'openGame' };

/**
 * "VB4: Settings": webview general de configuración del comportamiento de la
 * extensión. Agrupa el panel de autoguardado/caché y la sección de apariencia
 * (tema de colores + idioma de la interfaz).
 */
export function openSettings(context: vscode.ExtensionContext): void {
	const t = (key: string, params?: Record<string, string | number>) => LocaleManager.getInstance().t(key, params);
	const autosave = RecentFileAutosave.getInstance();
	const colors = SyntaxColorManager.getInstance();

	const panel = vscode.window.createWebviewPanel(
		'sb4Settings',
		t('st.panelTitle'),
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true
		}
	);

	const loadConfig = (): { enabled: boolean; mode: 'recent' | 'all'; maxAgeDays: number } => {
		const cfg = vscode.workspace.getConfiguration('sb4');
		return {
			enabled: cfg.get<boolean>('autosave.enabled', true),
			mode: cfg.get<'recent' | 'all'>('autosave.mode', 'recent'),
			maxAgeDays: cfg.get<number>('autosave.maxAgeDays', 7)
		};
	};

	const sendState = async () => {
		const cfg = loadConfig();
		const info = autosave.getSnapshotInfo();
		const themes = await colors.listExtensionThemes();
		const activeTheme = colors.getIniPath();
		const defaultThemePath = colors.getDefaultThemePath();

		let themeCurrent = '';
		if (activeTheme && activeTheme.toLowerCase() === defaultThemePath.toLowerCase()) {
			themeCurrent = '';
		} else if (activeTheme) {
			const match = themes.find(theme => theme.path.toLowerCase() === activeTheme.toLowerCase());
			themeCurrent = match ? match.path : '';
		}

		panel.webview.postMessage({
			command: 'state',
			enabled: cfg.enabled,
			mode: cfg.mode,
			maxAgeDays: cfg.maxAgeDays,
			count: info.count,
			lastFile: info.lastFile,
			lastUpdatedAt: info.lastUpdatedAt,
			themes,
			themeCurrent,
			languages: LocaleManager.getInstance().getLanguages().map(lang => ({
				id: lang.id,
				name: lang.duplicate
					? `${lang.nativeName} (${t('meta.duplicate', { id: lang.id })})`
					: lang.nativeName,
				current: lang.current
			})),
			languageId: LocaleManager.getInstance().getCurrentId()
		});
	};

	const applyConfig = async (changes: Record<string, unknown>) => {
		const cfg = vscode.workspace.getConfiguration('sb4');
		for (const [key, value] of Object.entries(changes)) {
			await cfg.update(key, value, vscode.ConfigurationTarget.Global);
		}
		void sendState();
		panel.webview.postMessage({ command: 'status', ok: true });
	};

	const openFolder = async (dir: string) => {
		try {
			await fsp.mkdir(dir, { recursive: true });
			await vscode.env.openExternal(vscode.Uri.file(dir));
		} catch {
			vscode.window.showInformationMessage(dir);
		}
	};

	panel.webview.onDidReceiveMessage((message: SettingsCommand) => {
		if (message.command === 'ready') {
			void sendState();
		} else if (message.command === 'setEnabled') {
			void applyConfig({ 'autosave.enabled': message.enabled });
		} else if (message.command === 'setMode') {
			void applyConfig({ 'autosave.mode': message.mode });
		} else if (message.command === 'setMaxAgeDays') {
			void applyConfig({ 'autosave.maxAgeDays': message.maxAgeDays });
		} else if (message.command === 'clearCache') {
			void autosave.clearCache().then(() => {
				void sendState();
				panel.webview.postMessage({ command: 'status', ok: true });
			});
		} else if (message.command === 'openThemeCreator') {
			void vscode.commands.executeCommand('sb4.themeCreator');
		} else if (message.command === 'openThemesFolder') {
			void openFolder(path.join(context.globalStorageUri.fsPath, 'themes'));
		} else if (message.command === 'setTheme') {
			void colors.selectTheme(message.path).then(ok => {
				void sendState();
				panel.webview.postMessage({ command: 'status', ok });
			});
		} else if (message.command === 'setLanguage') {
			void LocaleManager.getInstance().setLanguage(message.id).then(ok => {
				// Se re-renderiza la webview para que toda la UI cambie de idioma.
				panel.webview.html = getHtml(t);
				panel.webview.postMessage({ command: 'status', ok });
			});
		} else if (message.command === 'openLanguagesFolder') {
			void openFolder(path.join(context.globalStorageUri.fsPath, 'i18n'));
		} else if (message.command === 'importLanguage') {
			void LocaleManager.getInstance().importTexts().then(() => {
				void sendState();
				panel.webview.html = getHtml(t);
			});
		} else if (message.command === 'selectFolder') {
			void vscode.commands.executeCommand('sb4.selectFolder');
		} else if (message.command === 'selectVersion') {
			void vscode.commands.executeCommand('sb4.selectVersion');
		} else if (message.command === 'selectGameFolder') {
			void vscode.commands.executeCommand('sb4.selectGameFolder');
		} else if (message.command === 'selectLanguage') {
			void vscode.commands.executeCommand('sb4.selectLanguage');
		} else if (message.command === 'openLibrary') {
			void vscode.commands.executeCommand('sb4.openLibrary');
		} else if (message.command === 'searchOpcodes') {
			void vscode.commands.executeCommand('sb4.searchOpcodes');
		} else if (message.command === 'mergeCamera') {
			void vscode.commands.executeCommand('sb4.mergeCamera');
		} else if (message.command === 'expandOpcode') {
			void vscode.commands.executeCommand('sb4.expandOpcode');
		} else if (message.command === 'insertCoordinates') {
			void vscode.commands.executeCommand('sb4.insertCoordinates');
		} else if (message.command === 'insertAngle') {
			void vscode.commands.executeCommand('sb4.insertAngle');
		} else if (message.command === 'openGame') {
			void vscode.commands.executeCommand('sb4.openGame');
		}
	});

	panel.webview.html = getHtml(t);
}

function getHtml(t: (key: string, params?: Record<string, string | number>) => string): string {
	const L = JSON.stringify(LocaleManager.getInstance().getCatalog());
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
	:root { color-scheme: dark; }
	body { background: #1e1e1e; color: #cccccc; font-family: sans-serif; padding: 12px 16px 20px; }
	h1 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
	.sub { margin: 0 0 14px; font-size: 11px; color: #9d9d9d; }
	.section { border-top: 1px solid #333; padding-top: 12px; margin-top: 16px; }
	.section h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; color: #9d9d9d; }
	.row { display: flex; align-items: flex-start; gap: 10px; margin: 6px 0; }
	.row .label { flex: 1; }
	.row .label .name { font-size: 13px; }
	.row .label .desc { font-size: 11px; color: #9d9d9d; margin-top: 2px; }
	.toggle { position: relative; width: 30px; height: 20px; flex: none; margin-top: 2px; cursor: pointer; }
	.toggle input { opacity: 0; width: 100%; height: 100%; position: absolute; margin: 0; cursor: pointer; z-index: 2; }
	.toggle .track { position: absolute; inset: 0; background: #3a3d41; border-radius: 10px; transition: background .12s; }
	.toggle .track::after { content: attr(data-label); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #8c8c8c; }
	.toggle input:checked + .track { background: #0e639c; }
	.toggle input:checked + .track::after { color: #ffffff; }
	.modes { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px; }
	.modes label { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 12px; }
	.modes label input { margin-top: 2px; }
	.modes .d { display: block; font-size: 11px; color: #9d9d9d; margin-top: 1px; }
	.info { margin: 10px 0; font-size: 11px; color: #9d9d9d; background: #252526; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 10px; }
	.buttons { margin-top: 10px; }
	.btn { background: #3a3d41; color: #cccccc; border: 1px solid #3c3c3c; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-size: 12px; }
	.btn:hover { background: #45494e; }
	.btn.danger:hover { border-color: #e06c75; color: #e06c75; }
	.days { display: flex; align-items: center; gap: 8px; }
	.days input[type=number] { width: 64px; background: #252526; color: #cccccc; border: 1px solid #3c3c3c; border-radius: 4px; padding: 4px 6px; font-size: 12px; }
	.days input[type=number]:focus { outline: none; border-color: #0e639c; }
	select { width: 100%; background: #252526; color: #cccccc; border: 1px solid #3c3c3c; border-radius: 4px; padding: 5px 8px; font-size: 12px; }
	select:focus { outline: none; border-color: #0e639c; }
	.button-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
	.status { margin-top: 12px; font-size: 11px; color: #9d9d9d; }
	.status.ok { color: #6a9955; }
</style>
</head>
<body>
	<h1>${t('st.panelTitle')}</h1>
	<p class="sub">${t('st.subtitle')}</p>
	<div class="section">
		<h2>${t('st.appearanceSection')}</h2>
		<div class="row">
			<div class="label">
				<div class="name">${t('st.themeLabel')}</div>
				<select id="themeSelect"></select>
			</div>
		</div>
		<div class="button-row"><button class="btn" id="openThemeCreator">${t('st.openThemeCreator')}</button><button class="btn" id="openThemesFolder">${t('st.openThemesFolder')}</button></div>
		<div class="row">
			<div class="label">
				<div class="name">${t('st.languageLabel')}</div>
				<select id="languageSelect"></select>
			</div>
		</div>
		<div class="button-row">
			<button class="btn" id="openLanguagesFolder">${t('st.openLanguagesFolder')}</button>
			<button class="btn" id="importLanguage">${t('st.importLanguage')}</button>
		</div>
	</div>
	<div class="section">
		<h2>${t('st.selectSection')}</h2>
		<div class="button-row">
			<button class="btn" id="selectFolder">${t('st.selectFolderBtn')}</button>
			<button class="btn" id="selectVersion">${t('st.selectVersionBtn')}</button>
			<button class="btn" id="selectGameFolder">${t('st.selectGameFolderBtn')}</button>
			<button class="btn" id="selectLanguageBtn">${t('st.selectLanguageBtn')}</button>
		</div>
	</div>
	<div class="section">
		<h2>${t('st.featuresSection')}</h2>
		<p class="sub">${t('st.featuresSectionDesc')}</p>
		<div class="button-row">
			<button class="btn" id="openLibrary">${t('st.openLibraryBtn')}</button>
			<button class="btn" id="searchOpcodes">${t('st.searchOpcodesBtn')}</button>
			<button class="btn" id="mergeCamera">${t('st.mergeCameraBtn')}</button>
			<button class="btn" id="expandOpcode">${t('st.expandOpcodeBtn')}</button>
			<button class="btn" id="insertCoordinates">${t('st.insertCoordsBtn')}</button>
			<button class="btn" id="insertAngle">${t('st.insertAngleBtn')}</button>
			<button class="btn" id="openGame">${t('st.openGameBtn')}</button>
		</div>
	</div>
	<div class="section">
		<h2>${t('st.autosaveSection')}</h2>
		<div class="row">
			<label class="toggle"><input type="checkbox" id="autosaveEnabled"><span class="track" data-label=""></span></label>
			<div class="label">
				<div class="name">${t('st.autosaveEnabled')}</div>
				<div class="desc">${t('st.autosaveEnabledDesc')}</div>
			</div>
		</div>
		<div class="row">
			<div class="label">
				<div class="name">${t('st.autosaveModeLabel')}</div>
				<div class="modes">
					<label><input type="radio" name="mode" value="recent"><span>${t('st.modeRecent')}<span class="d">${t('st.modeRecentDesc')}</span></span></label>
					<label><input type="radio" name="mode" value="all"><span>${t('st.modeAll')}<span class="d">${t('st.modeAllDesc')}</span></span></label>
				</div>
			</div>
		</div>
		<div class="row">
			<div class="label">
				<div class="name">${t('st.cleanupTitle')}</div>
				<div class="desc">${t('st.cleanupDesc')}</div>
			</div>
		</div>
		<div class="row">
			<div class="label">
				<div class="name">${t('st.retentionLabel')}</div>
				<div class="desc">${t('st.retentionDesc')}</div>
			</div>
			<div class="days"><input type="number" id="maxAgeDays" min="0" max="365" step="1" value="7"></div>
		</div>
		<div class="info" id="cacheInfo">${t('st.cacheEmpty')}</div>
		<div class="buttons"><button class="btn danger" id="clearCache">${t('st.clearCache')}</button></div>
	</div>
	<div class="status" id="status">${t('st.statusReady')}</div>
	<script>
		(function () {
			const L = ${L};
			function t(key, params) {
				let s = L[key] || key;
				if (params) { s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (params[n] !== undefined ? String(params[n]) : m)); }
				return s;
			}
			const vscode = acquireVsCodeApi();
			const enabledEl = document.getElementById('autosaveEnabled');
			const infoEl = document.getElementById('cacheInfo');
			const statusEl = document.getElementById('status');
			const daysEl = document.getElementById('maxAgeDays');
			const themeEl = document.getElementById('themeSelect');
			const languageEl = document.getElementById('languageSelect');

			function setStatus(text, ok) {
				statusEl.textContent = text;
				statusEl.className = 'status' + (ok ? ' ok' : '');
			}

			function applyTrackLabel() {
				const track = enabledEl.nextElementSibling;
				if (track) { track.setAttribute('data-label', enabledEl.checked ? 'ON' : 'OFF'); }
			}

			function fillOptions(el, options, selected) {
				el.innerHTML = '';
				for (const opt of options) {
					const option = document.createElement('option');
					option.value = opt.value;
					option.textContent = opt.label;
					option.selected = opt.value === selected;
					el.appendChild(option);
				}
			}

			function onState(msg) {
				enabledEl.checked = !!msg.enabled;
				applyTrackLabel();
				daysEl.value = String(msg.maxAgeDays != null ? msg.maxAgeDays : 7);
				const radios = Array.from(document.querySelectorAll('input[name="mode"]'));
				radios.forEach(r => { r.checked = r.value === msg.mode; });
				if (msg.lastFile) {
					infoEl.textContent = t('st.cacheInfo', { n: String(msg.count), file: msg.lastFile });
				} else {
					infoEl.textContent = t('st.cacheEmpty');
				}
				const themeOptions = [{ value: '', label: t('st.themeDefault') }].concat(
					(msg.themes || []).map(theme => ({ value: theme.path, label: theme.label }))
				);
				fillOptions(themeEl, themeOptions, msg.themeCurrent || '');
				const langOptions = (msg.languages || []).map(lang => ({ value: lang.id, label: lang.name }));
				fillOptions(languageEl, langOptions, msg.languageId);
				setStatus(t('st.statusReady'));
			}

			enabledEl.addEventListener('change', () => {
				applyTrackLabel();
				vscode.postMessage({ command: 'setEnabled', enabled: enabledEl.checked });
			});

			Array.from(document.querySelectorAll('input[name="mode"]')).forEach(r => r.addEventListener('change', () => {
				if (r.checked) { vscode.postMessage({ command: 'setMode', mode: r.value }); }
			}));

			daysEl.addEventListener('change', () => {
				let v = parseInt(daysEl.value, 10);
				if (Number.isNaN(v)) { v = 7; }
				v = Math.max(0, Math.min(365, v));
				daysEl.value = String(v);
				vscode.postMessage({ command: 'setMaxAgeDays', maxAgeDays: v });
			});

			document.getElementById('clearCache').addEventListener('click', () => vscode.postMessage({ command: 'clearCache' }));
			document.getElementById('openThemeCreator').addEventListener('click', () => vscode.postMessage({ command: 'openThemeCreator' }));
			document.getElementById('openThemesFolder').addEventListener('click', () => vscode.postMessage({ command: 'openThemesFolder' }));
			document.getElementById('openLanguagesFolder').addEventListener('click', () => vscode.postMessage({ command: 'openLanguagesFolder' }));
			document.getElementById('importLanguage').addEventListener('click', () => vscode.postMessage({ command: 'importLanguage' }));
			document.getElementById('selectFolder').addEventListener('click', () => vscode.postMessage({ command: 'selectFolder' }));
			document.getElementById('selectVersion').addEventListener('click', () => vscode.postMessage({ command: 'selectVersion' }));
			document.getElementById('selectGameFolder').addEventListener('click', () => vscode.postMessage({ command: 'selectGameFolder' }));
			document.getElementById('selectLanguageBtn').addEventListener('click', () => vscode.postMessage({ command: 'selectLanguage' }));

			document.getElementById('openLibrary').addEventListener('click', () => vscode.postMessage({ command: 'openLibrary' }));
			document.getElementById('searchOpcodes').addEventListener('click', () => vscode.postMessage({ command: 'searchOpcodes' }));
			document.getElementById('mergeCamera').addEventListener('click', () => vscode.postMessage({ command: 'mergeCamera' }));
			document.getElementById('expandOpcode').addEventListener('click', () => vscode.postMessage({ command: 'expandOpcode' }));
			document.getElementById('insertCoordinates').addEventListener('click', () => vscode.postMessage({ command: 'insertCoordinates' }));
			document.getElementById('insertAngle').addEventListener('click', () => vscode.postMessage({ command: 'insertAngle' }));
			document.getElementById('openGame').addEventListener('click', () => vscode.postMessage({ command: 'openGame' }));

			themeEl.addEventListener('change', () => vscode.postMessage({ command: 'setTheme', path: themeEl.value }));
			languageEl.addEventListener('change', () => vscode.postMessage({ command: 'setLanguage', id: languageEl.value }));

			window.addEventListener('message', event => {
				const msg = event.data;
				if (msg.command === 'state') { onState(msg); }
				else if (msg.command === 'status') { setStatus(t('st.saved'), true); }
			});

			document.addEventListener('DOMContentLoaded', () => vscode.postMessage({ command: 'ready' }));
			vscode.postMessage({ command: 'ready' });
		})();
	</script>
</body>
</html>`;
}
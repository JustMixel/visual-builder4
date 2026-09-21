import { Singleton, showInfoToast } from '@utils';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CATALOG_INFO, CATALOGS, CATALOG_TEMPLATES, DEFAULT_LANGUAGE, MessageParams } from './catalog';

export interface LanguageInfo {
	id: string;
	name: string;
	nativeName: string;
	imported: boolean;
	current: boolean;
	/** true cuando otro idioma usa el mismo nombre mostrado (duplicado). */
	duplicate?: boolean;
}

interface PersistedLanguage {
	name?: string;
	catalog: Record<string, string>;
}

interface PersistedData {
	languages: Record<string, PersistedLanguage>;
}

const CONFIG_KEY = 'language';

/**
 * Gestión de idiomas de la UI de la extensión.
 * - Idiomas incorporados: en (base) y es.
 * - Textos exportables/importables: "VB4: Export UI Texts" / "VB4: Import
 *   UI Texts" permiten crear idiomas nuevos a partir de un JSON editable.
 * - Los idiomas importados viven como ARCHIVOS FÍSICOS editables en
 *   <globalStorage>/i18n/<id>.json ({ id, name, catalog }); se pueden
 *   modificar/copiar/renombrar y se recargan en cada inicio.
 * - t(key, params) resuelve el texto del idioma activo con fallback a en.
 */
export class LocaleManager extends Singleton {
	private context?: vscode.ExtensionContext;
	private selectedId = DEFAULT_LANGUAGE;
	private imported = new Map<string, PersistedLanguage>();
	private importedLoaded = false;
	private onChangeHandlers: Array<() => void> = [];

	public async init(context: vscode.ExtensionContext): Promise<void> {
		this.context = context;
		await this.loadImported();

		// Resolución de idioma: el configurado si existe → si no, inglés → si
		// inglés tampoco existe, uno aleatorio → si no hay ninguno, la base `en`.
		const desired = this.sanitizeId(
			vscode.workspace.getConfiguration('sb4').get<string>(CONFIG_KEY, DEFAULT_LANGUAGE)
		) || DEFAULT_LANGUAGE;
		this.selectedId = this.resolveLanguageId(desired);

		this.assertCatalogsComplete();
	}

	/**
	 * Encadena el fallback del idioma activo:
	 * 1. el id deseado (config) si está cargado;
	 * 2. 'en' si existe como copia física;
	 * 3. un idioma aleatorio de los cargados (si hay);
	 * 4. DEFAULT_LANGUAGE (base de textos en inglés, aunque no haya copia).
	 */
	private resolveLanguageId(desired: string): string {
		if (this.imported.has(desired)) {
			return desired;
		}
		if (this.imported.has(DEFAULT_LANGUAGE)) {
			return DEFAULT_LANGUAGE;
		}
		const ids = Array.from(this.imported.keys());
		if (ids.length > 0) {
			return ids[Math.floor(Math.random() * ids.length)];
		}
		return DEFAULT_LANGUAGE;
	}

	/** Texto traducido del idioma activo, con interpolación de {params}. */
	public t(key: string, params?: MessageParams): string {
		const text = this.getCatalogOf(this.selectedId)[key] ?? CATALOGS.en[key] ?? key;

		if (!params) {
			return text;
		}

		return text.replace(/\{(\w+)\}/g, (match, name: string) =>
			params[name] !== undefined ? String(params[name]) : match
		);
	}

	public getCurrentId(): string {
		return this.selectedId;
	}

	public getCurrentInfo(): LanguageInfo | undefined {
		return this.getLanguages().find(lang => lang.id === this.selectedId);
	}

	public getLanguages(): LanguageInfo[] {
		// SOLO copias físicas: no hay idiomas integrados además de la base en.
		const imported: LanguageInfo[] = Array.from(this.imported.entries()).map(([id, data]) => ({
			id,
			name: data.name ?? id,
			nativeName: data.name ?? id,
			imported: true,
			current: id === this.selectedId
		})).sort((a, b) => a.nativeName.localeCompare(b.nativeName));

		// Marca como duplicado cualquier idioma posterior que comparta el mismo
		// nombre mostrado (p. ej. dos archivos con name "Español"). El primero
		// que aparece se considera el original; el resto, duplicados.
		const seen = new Set<string>();
		for (const lang of imported) {
			const key = lang.nativeName.trim().toLowerCase();
			if (seen.has(key)) {
				lang.duplicate = true;
			} else {
				seen.add(key);
			}
		}

		return imported;
	}

	/** Catálogo completo del idioma activo (base en + traducciones). */
	public getCatalog(): Record<string, string> {
		return { ...CATALOGS.en, ...this.getCatalogOf(this.selectedId) };
	}

	public onDidChange(handler: () => void): () => void {
		this.onChangeHandlers.push(handler);
		return () => {
			const index = this.onChangeHandlers.indexOf(handler);
			if (index >= 0) {
				this.onChangeHandlers.splice(index, 1);
			}
		};
	}

	public async setLanguage(id: string): Promise<boolean> {
		if (!this.isKnownId(id)) {
			return false;
		}

		this.selectedId = id;
		await vscode.workspace.getConfiguration('sb4').update(CONFIG_KEY, id, vscode.ConfigurationTarget.Global);

		for (const handler of [...this.onChangeHandlers]) {
			try {
				handler();
			} catch {
				// Un handler que falle no debe romper el cambio de idioma.
			}
		}
		return true;
	}

	// ------------------------------------------------------------------
	// Comandos: selector, exportar e importar
	// ------------------------------------------------------------------

	public async selectLanguage(): Promise<void> {
		const langs = this.getLanguages();

		const items: Array<vscode.QuickPickItem & { languageId?: string; action?: 'export' | 'import' }> = [
			...langs.map(lang => ({
				label: `${lang.current ? '$(check) ' : ''}${lang.nativeName}${lang.duplicate ? ` (${this.t('meta.duplicate', { id: lang.id })})` : ''}`,
				description: lang.duplicate
					? `${lang.id} · ${this.t('meta.duplicate', { id: lang.id })}`
					: lang.imported ? lang.id : this.t('meta.current'),
				languageId: lang.id
			})),
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: this.t('meta.exportAction'), action: 'export' as const },
			{ label: this.t('meta.importAction'), action: 'import' as const }
		];

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: this.t('meta.placeholderPick'),
			title: this.t('meta.languageDialogTitle')
		});

		if (!picked) {
			return;
		}

		if (picked.action === 'export') {
			await this.exportTexts();
			return;
		}
		if (picked.action === 'import') {
			await this.importTexts();
			return;
		}
		if (picked.languageId && picked.languageId !== this.selectedId && await this.setLanguage(picked.languageId)) {
			const info = this.getCurrentInfo();
			await showInfoToast(this.t('meta.languageSet', { name: info?.nativeName ?? picked.languageId }));
		}
	}

	/**
	 * Exporta los textos del idioma elegido a un JSON editable para crear
	 * nuevos idiomas (formato: { id, name, texts: {...} }).
	 */
	public async exportTexts(): Promise<void> {
		const langs = this.getLanguages();

		const picked = await vscode.window.showQuickPick(langs.map(lang => ({
			label: lang.nativeName,
			description: `${lang.id} · ${lang.imported ? 'imported' : 'built-in'}`,
			languageId: lang.id
		})), {
			title: this.t('meta.exportDialogTitle'),
			placeHolder: this.t('meta.exportPickPrompt')
		});

		if (!picked || !this.context) {
			return;
		}

		const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.globalStorageUri.fsPath;
		const uri = await vscode.window.showSaveDialog({
			title: this.t('meta.exportDialogTitle'),
			defaultUri: vscode.Uri.file(path.join(defaultDir, `${picked.languageId}-ui-texts.json`)),
			filters: { 'UI texts JSON': ['json'] }
		});

		if (!uri) {
			return;
		}

		const catalog = this.getCatalogOf(picked.languageId);
		const info = this.getLanguages().find(lang => lang.id === picked.languageId);

		const payload = JSON.stringify({ id: picked.languageId, name: info?.nativeName ?? picked.languageId, texts: catalog }, null, 2) + '\n';

		try {
			await fsp.writeFile(uri.fsPath, payload, 'utf-8');
			await showInfoToast(this.t('meta.exportSaved', { path: uri.fsPath }));
		} catch {
			await vscode.window.showErrorMessage(this.t('meta.couldNotRead'));
		}
	}

	/**
	 * Importa un JSON de textos (exportado o creado a mano) como idioma nuevo.
	 * Los claves que falten caen al inglés; el ID se toma del archivo o de un
	 * prompt si colisiona con un idioma incorporado.
	 */
	public async importTexts(): Promise<void> {
		if (!this.context) {
			return;
		}

		const uri = await vscode.window.showOpenDialog({
			title: this.t('meta.importDialogTitle'),
			canSelectFiles: true,
			canSelectMany: false,
			filters: { 'UI texts JSON': ['json'] }
		});

		if (!uri || uri.length === 0) {
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(await fsp.readFile(uri[0].fsPath, 'utf-8')) as unknown;
		} catch {
			await vscode.window.showErrorMessage(this.t('meta.invalidJson'));
			return;
		}

		const fileTexts = this.extractTexts(parsed);
		if (!fileTexts) {
			await vscode.window.showErrorMessage(this.t('meta.invalidCatalog'));
			return;
		}

		let id = this.sanitizeId(typeof parsed === 'object' && parsed !== null && (parsed as any).id ? String((parsed as any).id) : '');
		if (!id) {
			id = this.sanitizeId(path.basename(uri[0].fsPath, path.extname(uri[0].fsPath)));
		}
		if (!id) {
			id = this.sanitizeId(this.t('meta.importDefaultId')) || 'custom';
		}

		if (CATALOGS[id]) {
			await vscode.window.showErrorMessage(this.t('meta.builtinProtected', { name: CATALOG_INFO[id]?.name ?? id }));
			return;
		}

		if (this.imported.has(id)) {
			const action = await vscode.window.showWarningMessage(
				this.t('meta.idExists', { id }),
				{ modal: true },
				this.t('meta.overwrite'),
				this.t('meta.cancel')
			);
			if (action !== this.t('meta.overwrite')) {
				return;
			}
		}

		const valid = Object.keys(fileTexts).length;
		const missing = Object.keys(CATALOGS.en).filter(key => fileTexts[key] === undefined).length;

		const rawName = typeof parsed === 'object' && parsed !== null && (parsed as any).name
			? String((parsed as any).name).trim()
			: '';
		this.imported.set(id, { name: rawName || id, catalog: fileTexts });
		await this.saveImported();

		await showInfoToast(this.t('meta.importStats', { id, valid, missing }));

		const apply = await vscode.window.showInformationMessage(
			this.t('meta.applyNow', { id }),
			{ modal: true },
			this.t('meta.applyYes'),
			this.t('meta.applyNo')
		);
		if (apply === this.t('meta.applyYes')) {
			await this.setLanguage(id);
		}
	}

	// ------------------------------------------------------------------
	// Internos
	// ------------------------------------------------------------------

	private getCatalogOf(id: string): Record<string, string> {
		if (this.importedLoaded && this.imported.has(id)) {
			return this.imported.get(id)!.catalog;
		}
		return CATALOGS[id] ?? {};
	}

	private isKnownId(id: string): boolean {
		return CATALOGS[id] !== undefined || (this.importedLoaded && this.imported.has(id));
	}

	private sanitizeId(id: string): string {
		return id.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
	}

	private extractTexts(parsed: unknown): Record<string, string> | undefined {
		if (typeof parsed !== 'object' || parsed === null) {
			return undefined;
		}

		const source = (parsed as any).texts && typeof (parsed as any).texts === 'object' ? (parsed as any).texts : parsed;
		if (typeof source !== 'object' || source === null) {
			return undefined;
		}

		const texts: Record<string, string> = {};
		for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
			if (typeof value === 'string') {
				texts[key] = value;
			}
		}

		return Object.keys(texts).length > 0 ? texts : undefined;
	}

	private async languagesDir(): Promise<string> {
		const dir = path.join(this.context!.globalStorageUri.fsPath, 'i18n');
		await fsp.mkdir(dir, { recursive: true }).catch(() => { });
		return dir;
	}

	private async loadImported(): Promise<void> {
		this.imported.clear();
		this.importedLoaded = true;

		const dir = await this.languagesDir();
		await this.migrateLegacyLanguages(dir);

		let entries: string[];
		try {
			entries = (await fsp.readdir(dir)).filter(name => name.toLowerCase().endsWith('.json'));
		} catch {
			return;
		}

		let patched = false;
		for (const entry of entries) {
			const id = this.sanitizeId(path.basename(entry, '.json'));
			if (!id) {
				continue;
			}
			try {
				const data = JSON.parse(await fsp.readFile(path.join(dir, entry), 'utf-8')) as Partial<PersistedLanguage>;
				const catalog = data.catalog ?? (data as any).texts;
				if (data && typeof catalog === 'object' && catalog !== null) {
					// Auto-sync: las claves que el template canónico trae y que la
					// copia no tiene todavía (actualizaciones de la extensión) se
					// rellenan al iniciar, sin tocar las traducciones existentes.
					const template = CATALOG_TEMPLATES[id];
					if (template) {
						for (const key of Object.keys(template)) {
							if (catalog[key] === undefined) {
								catalog[key] = template[key];
								patched = true;
							}
						}
					}
					this.imported.set(id, {
						name: typeof data.name === 'string' ? data.name : undefined,
						catalog
					});
				}
			} catch {
				// Archivo malformado (editado a mano): se ignora pero no se borra.
			}
		}

		if (patched) {
			await this.saveImported();
		}
	}

	/**
	 * Convierte el blob histórico languages.json en archivos físicos por
	 * idioma (<id>.json) y lo elimina.
	 */
	private async migrateLegacyLanguages(dir: string): Promise<void> {
		const legacyPath = path.join(dir, 'languages.json');
		try {
			const data = JSON.parse(await fsp.readFile(legacyPath, 'utf-8')) as PersistedData;
			for (const [id, lang] of Object.entries(data.languages ?? {})) {
				const safeId = this.sanitizeId(id);
				if (!safeId || !lang || typeof lang.catalog !== 'object' || lang.catalog === null) {
					continue;
				}
				const payload = JSON.stringify({ id: safeId, name: lang.name ?? safeId, catalog: lang.catalog }, null, 2) + '\n';
				await fsp.writeFile(path.join(dir, `${safeId}.json`), payload, 'utf-8');
			}
			await fsp.unlink(legacyPath);
		} catch {
			// Sin blob legacy: nada que migrar.
		}
	}

	private async saveImported(): Promise<void> {
		// Un archivo físico por idioma: <globalStorage>/i18n/<id>.json
		// ({ id, name, catalog }). Editables por el usuario.
		const dir = await this.languagesDir();
		for (const [id, lang] of this.imported) {
			const payload = JSON.stringify({ id, name: lang.name ?? id, catalog: lang.catalog }, null, 2) + '\n';
			await fsp.writeFile(path.join(dir, `${id}.json`), payload, 'utf-8');
		}
	}

	private assertCatalogsComplete(): void {
		for (const [id, catalog] of Object.entries(CATALOGS)) {
			if (id === DEFAULT_LANGUAGE) {
				continue;
			}
			for (const key of Object.keys(CATALOGS.en)) {
				if (catalog[key] === undefined) {
					console.warn(`[VB4] Missing translation "${key}" in language "${id}".`);
				}
			}
		}
	}
}
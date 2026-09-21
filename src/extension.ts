import { CommandManager, FolderManager, GameFolderManager, GtaVersionManager, LanguageManager, StorageDataManager, SyntaxColorManager } from '@managers';
import { BaseProvider, CameraMergeProvider, ClassProvider, CoordsProvider, CommandFormatterProvider, DefinitionSearch, EnumProvider, FxtDiagnostics, FxtNextEntry, JumpIncludeProvider, LibraryProvider, LoopWaitDiagnostics, ModelProvider, OpcodeProvider, OpcodeExpandProvider, OpcodeTabFillProvider, OpcodesSearch, ReferenceSearch, SyntaxColoringProvider } from '@providers';
import { LocaleManager } from '@i18n';
import * as vscode from 'vscode';
import { CompileCommand } from './compiler-tools/compile-command';
import { DecompileCommand } from './compiler-tools/decompile-command';
import { DeveloperTools } from './compiler-tools/developer-tools';
import { GtaVersionButton } from './components/gta-version-button.component';
import { FxtEncodingGuard } from './components/fxt-encoding-guard';
import { VirtualDocumentProvider } from './components/virtual-document-provider.component';
import { RecentFileAutosave } from './components/recent-file-autosave.component';
import { openThemeCreator } from './components/theme-creator';
import { openSettings } from './components/extension-settings.component';
import { promises as fsp } from 'fs';

function openDataFolder(context: vscode.ExtensionContext): void {
	void (async () => {
		try {
			// Abre la carpeta de datos de la extensión (globalStorage), donde
			// viven los temas, los idiomas importados y las cachés.
			const dir = context.globalStorageUri.fsPath;
			await fsp.mkdir(dir, { recursive: true });
			await vscode.env.openExternal(vscode.Uri.file(dir));
		} catch {
			// Best effort: si falla, la ruta igual se muestra en los ajustes.
			vscode.window.showInformationMessage(context.globalStorageUri.fsPath);
		}
	})();
}

export async function activate(context: vscode.ExtensionContext) {
    await LocaleManager.getInstance().init(context);
    StorageDataManager.getInstance().init(context);
    await GtaVersionManager.getInstance().init();
    await CommandManager.getInstance().init();
    CommandFormatterProvider.getInstance().init();
    FolderManager.getInstance().init(context);
    GameFolderManager.getInstance().init(context);
    GtaVersionButton.getInstance().init(context);
    new FxtEncodingGuard().init(context);
    LanguageManager.getInstance().init(context);
    VirtualDocumentProvider.getInstance().init(context);
    RecentFileAutosave.getInstance().init(context);
    CompileCommand.getInstance().init(context);
    DecompileCommand.getInstance().init(context);
    DeveloperTools.getInstance().init(context);

    BaseProvider.getInstance().init(context);

    vscode.commands.registerCommand('sb4.selectVersion', () => GtaVersionButton.getInstance().handleVersionSelection());
    vscode.commands.registerCommand('sb4.selectLanguage', () => LocaleManager.getInstance().selectLanguage());
    vscode.commands.registerCommand('sb4.exportTexts', () => LocaleManager.getInstance().exportTexts());
    vscode.commands.registerCommand('sb4.importTexts', () => LocaleManager.getInstance().importTexts());
    vscode.commands.registerCommand('sb4.openSettings', () => openSettings(context));
    vscode.commands.registerCommand('sb4.openDataFolder', () => openDataFolder(context));

    JumpIncludeProvider.getInstance().register();
    LoopWaitDiagnostics.getInstance().register();
    await CoordsProvider.getInstance().init(context).register();

await EnumProvider.getInstance().init();
	ClassProvider.getInstance().init();
	OpcodeProvider.getInstance().init();
	OpcodeExpandProvider.getInstance().register();
	OpcodeTabFillProvider.getInstance().register();
	CameraMergeProvider.getInstance().register();
	LibraryProvider.getInstance().register();
	FxtNextEntry.getInstance().register();
	FxtDiagnostics.getInstance().register();
	await ModelProvider.getInstance().init();

    await SyntaxColoringProvider.getInstance().init();
    vscode.commands.registerCommand('sb4.reloadColors', () => SyntaxColoringProvider.getInstance().reload());
    vscode.commands.registerCommand('sb4.customizeColors', () => SyntaxColorManager.getInstance().customizeColors());
    vscode.commands.registerCommand('sb4.customizeFontStyles', () => SyntaxColorManager.getInstance().customizeFontStyles());
    vscode.commands.registerCommand('sb4.importTheme', () => SyntaxColorManager.getInstance().importTheme());
    vscode.commands.registerCommand('sb4.themeCreator', () => openThemeCreator());

    DefinitionSearch.getInstance().init();
    ReferenceSearch.getInstance().init();
    OpcodesSearch.getInstance().create();
}
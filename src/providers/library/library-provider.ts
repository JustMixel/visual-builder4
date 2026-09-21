import { Singleton, showInfoToast } from '@utils';
import * as vscode from 'vscode';
import { LocaleManager } from '@i18n';
import { GtaVersionManager } from '@managers';
import { BaseProvider } from '../base';

interface LibrarySection {
    id: string;
    section: string;
    label: string;
}

// Secciones del Sanny Builder Library (https://library.sannybuilder.com/).
// Cada modo de SB4 (id de mode.xml) se resuelve a la ruta `#/<section>` más
// fiel: gta3/vc/sa apuntan a su sección principal; los modos mobile apuntan
// a la sección de la plataforma correspondiente.
const LIBRARY_SECTIONS: LibrarySection[] = [
    { id: 'gta3_mobile', section: 'gta3_mobile', label: 'GTA III' },
    { id: 'gta3_ps2', section: 'gta3_ps2', label: 'GTA III' },
    { id: 'gta3', section: 'gta3', label: 'GTA III' },
    { id: 'gta_iv', section: 'gta_iv', label: 'GTA IV' },
    { id: 'lcs_mobile', section: 'lcs', label: 'Liberty City Stories' },
    { id: 'lcs', section: 'lcs', label: 'Liberty City Stories' },
    { id: 'sa_mobile', section: 'sa_mobile', label: 'San Andreas' },
    { id: 'sa', section: 'sa', label: 'San Andreas' },
    { id: 'vc_mobile', section: 'vc_mobile', label: 'Vice City' },
    { id: 'vc', section: 'vc', label: 'Vice City' },
    { id: 'vcs', section: 'vcs', label: 'Vice City Stories' },
];

// Dominio canónico y confiable de la biblioteca. La URL NUNCA se construye a
// partir de un string arbitrario: se arma con Uri.from({ scheme, authority })
// y se valida (scheme https + authority === LIBRARY_HOST) antes de la llamada
// a openExternal.
const LIBRARY_SCHEME = 'https';
const LIBRARY_HOST = 'library.sannybuilder.com';

/** Arma la URI de la biblioteca. Sin sección → portada (`/#/`). */
function libraryUri(section?: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: LIBRARY_SCHEME,
        authority: LIBRARY_HOST,
        path: '/',
        fragment: section ? `/${section}` : undefined,
    });
}

/** True solo si la URI apunta al dominio confiable de la biblioteca. */
function isTrustedLibraryUri(uri: vscode.Uri): boolean {
    return uri.scheme === LIBRARY_SCHEME &&
        uri.authority.toLowerCase() === LIBRARY_HOST;
}

/**
 * "Ctrl+Alt+L": abre el Sanny Builder Library (https://library.sannybuilder.com/)
 * en el navegador, saltando a la sección del juego correspondiente al modo de
 * GTA activo (GTA III / Vice City / San Andreas, etc.). Si no hay modo
 * seleccionado o no hay sección mapeada, abre la portada de la biblioteca.
 * La URL se fija al dominio confiable (https://library.sannybuilder.com) y se
 * valida antes de llamar a openExternal.
 */
export class LibraryProvider extends Singleton {
    private baseProvider: BaseProvider = BaseProvider.getInstance();

    private static t = (key: string, params?: Record<string, string | number>) =>
        LocaleManager.getInstance().t(key, params);

    public register() {
        this.baseProvider.context.subscriptions.push(
            vscode.commands.registerCommand('sb4.openLibrary', () => this.open())
        );
    }

    /** Resuelve el id del modo SB4 a la sección de la biblioteca. */
    private resolveSection(identifier: string): LibrarySection | undefined {
        const exact = LIBRARY_SECTIONS.find(entry => entry.id === identifier);
        if (exact) {
            return exact;
        }

        // Prefijos: `sa_sbl`, `sa_v2`, `vc_sbl`, `gta3_sbl`… caen en su juego.
        // La búsqueda recorre en orden, así que los ids específicos
        // (gta3_mobile, etc.) ganan a los genéricos (gta3).
        return LIBRARY_SECTIONS.find(entry => identifier.startsWith(`${entry.id}_`));
    }

    private async open() {
        const identifier = GtaVersionManager.getInstance().getIdentifier();

        const section = identifier
            ? this.resolveSection(identifier)
            : undefined;

        let uri = libraryUri();

        if (identifier && !section) {
            void showInfoToast(LibraryProvider.t('sl.unknown', { id: identifier }));
        } else if (!section) {
            void showInfoToast(LibraryProvider.t('sl.noVersion'));
        } else {
            uri = libraryUri(section.section);
            void showInfoToast(LibraryProvider.t('sl.opened', { game: section.label }));
        }

        if (!isTrustedLibraryUri(uri)) {
            void vscode.window.showErrorMessage(LibraryProvider.t('sl.untrusted'));
            return;
        }

        await vscode.env.openExternal(uri);
    }
}
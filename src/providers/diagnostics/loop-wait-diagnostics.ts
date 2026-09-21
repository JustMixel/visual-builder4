import { CONFIG, Singleton } from '@utils';
import * as vscode from 'vscode';
import { Token } from '../../lexer/token';
import { TokenKind } from '../../lexer/token-kind';
import { Tokenizer } from '../../lexer/tokenizer';
import { BaseProvider } from '../base';

// Bloques que se cierran con 'end' y necesitan ser rastreados solo para
// saber cuándo termina un WHILE/REPEAT que los contiene (no se les exige wait).
const NESTED_END_BLOCKS = new Set(['if', 'while', 'for', 'switch', 'function']);
const REPEAT_BLOCK = 'repeat';

// Bloques que SÍ deben contener un 'wait' en su cuerpo.
const LOOP_BLOCKS = new Set(['while', 'repeat']);

const DIAGNOSTIC_SOURCE = 'SB4';
const DIAGNOSTIC_CODE = 'missing-wait-in-loop';
const DEBOUNCE_MS = 400;

interface BlockFrame {
    type: string;
    token: Token;
    sawWait: boolean;
}

/**
 * Marca con un warning cualquier bloque WHILE/REPEAT que no contenga un
 * 'wait' en su cuerpo. Un loop así puede congelar el juego al ejecutarse,
 * ya que nunca le cede tiempo al motor entre iteraciones.
 *
 * Nota: es un chequeo heurístico basado en texto, no un análisis real de
 * flujo de control -- si el 'wait' está en un camino que no siempre se
 * ejecuta (ej. dentro de un IF sin ELSE), igual se considera "cubierto".
 * Tampoco distingue comentarios de bloque (comment-block, no line-comment)
 * porque el tokenizer compartido aún no los reconoce -- un 'wait' comentado
 * así puede dar un falso negativo.
 */
export class LoopWaitDiagnostics extends Singleton {
    private baseProvider: BaseProvider = BaseProvider.getInstance();
    private collection!: vscode.DiagnosticCollection;
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    // Contador de "generación": si llega un cambio nuevo mientras se analiza,
    // el análisis en curso se aborta y el nuevo programa se corre con prio.
    private generation = 0;

    public register() {
        this.collection = vscode.languages.createDiagnosticCollection('sb4-loop-wait');
        this.baseProvider.context.subscriptions.push(this.collection);

        vscode.workspace.textDocuments
            .filter(doc => doc.languageId === CONFIG.LANGUAGE_SELECTOR.language)
            .forEach(doc => void this.analyze(doc));

        this.baseProvider.context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.scheduleAnalyze(doc)),
            vscode.workspace.onDidChangeTextDocument(e => this.scheduleAnalyze(e.document)),
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.collection.delete(doc.uri);
                this.clearTimer(doc.uri.toString());
            })
        );
    }

    private scheduleAnalyze(document: vscode.TextDocument) {
        if (document.languageId !== CONFIG.LANGUAGE_SELECTOR.language) {
            return;
        }

        const key = document.uri.toString();
        this.clearTimer(key);

        this.debounceTimers.set(key, setTimeout(() => {
            this.debounceTimers.delete(key);
            void this.analyze(document);
        }, DEBOUNCE_MS));
    }

    private clearTimer(key: string) {
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.debounceTimers.delete(key);
        }
    }

    /**
     * Análisis por CHUNKS: procesa el documento línea a línea y cede al event
     * loop cada ~1024 líneas, para que el coloreo (debounce 16 ms) no quede
     * bloqueado mientras se escanea un archivo grande. Si aparece un cambio
     * más nuevo (debounce se re-dispara), este pase se descarta al instante.
     */
    private async analyze(document: vscode.TextDocument) {
        const gen = ++this.generation;
        const diagnostics: vscode.Diagnostic[] = [];
        const stack: BlockFrame[] = [];
        const lines = document.getText().split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            if (this.generation !== gen) {
                return;
            }
            const tokens = new Tokenizer().tokenize(lines[i]);
            for (const token of tokens) {
                // El Tokenizer por-línea reporta "línea 1" siempre; se corrige
                // el número de línea absoluto para el diagnostic.
                token.line = i + 1;
                if (token.kind !== TokenKind.Identifier) {
                    continue;
                }
                this.consume(token, stack, diagnostics);
            }
            if ((i & 1023) === 1023) {
                await this.yieldToEventLoop();
            }
        }

        if (this.generation === gen) {
            this.collection.set(document.uri, diagnostics);
        }
    }

    private yieldToEventLoop(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    private consume(token: Token, stack: BlockFrame[], diagnostics: vscode.Diagnostic[]) {
        const word = token.text.toLowerCase();

        if (word === 'wait') {
            for (const frame of stack) {
                frame.sawWait = true;
            }
            return;
        }

        if (word === REPEAT_BLOCK || NESTED_END_BLOCKS.has(word)) {
            stack.push({ type: word, token, sawWait: false });
            return;
        }

        if (word === 'until') {
            const top = stack[stack.length - 1];
            if (top?.type === REPEAT_BLOCK) {
                stack.pop();
                if (!top.sawWait) {
                    diagnostics.push(this.buildDiagnostic(top));
                }
            }
            return;
        }

        if (word === 'end') {
            const top = stack.pop();
            if (top && LOOP_BLOCKS.has(top.type) && !top.sawWait) {
                diagnostics.push(this.buildDiagnostic(top));
            }
            return;
        }
    }

    private buildDiagnostic(frame: BlockFrame): vscode.Diagnostic {
        const line = Math.max(frame.token.line - 1, 0);
        const range = new vscode.Range(line, frame.token.col, line, frame.token.col + frame.token.text.length);

        const diagnostic = new vscode.Diagnostic(
            range,
            `Este bloque '${frame.type.toUpperCase()}' no contiene 'wait' en su cuerpo. Un loop sin wait puede congelar el juego.`,
            vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = DIAGNOSTIC_CODE;
        diagnostic.source = DIAGNOSTIC_SOURCE;
        return diagnostic;
    }
}

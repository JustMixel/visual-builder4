import { CommandManager } from '@managers';
import { CONFIG, Singleton } from '@utils';
import * as vscode from 'vscode';
import { Token } from '../../lexer/token';
import { TokenKind } from '../../lexer/token-kind';
import { Tokenizer } from '../../lexer/tokenizer';
import { BUILTIN_CLASSES, BUILTIN_CLASS_MEMBERS } from '../../builders/builtin-library';
import { SyntaxColorManager, SyntaxColorStyle } from '../../managers/syntax-color-manager';
import { BaseProvider } from '../base';
import { ClassProvider } from '../class/class';
import { EnumProvider } from '../enum/enum';

const CATEGORY_COMMENTS = 'comments';
const CATEGORY_LABELS = 'labels';
const CATEGORY_VARIABLES = 'variables';
const CATEGORY_KEYWORDS = 'keywords';
const CATEGORY_KEYWORDS_IF = 'keywordsIf';
const CATEGORY_KEYWORDS_SWITCH = 'keywordsSwitch';
const CATEGORY_KEYWORDS_LOOP = 'keywordsLoop';
const CATEGORY_KEYWORDS_BOOLEAN = 'keywordsBoolean';
const CATEGORY_NUMBERS = 'numbers';
const CATEGORY_STRINGS = 'strings';
const CATEGORY_CLASSES = 'classes';
const CATEGORY_COMMANDS = 'commands';
const CATEGORY_ENUMS = 'enums';
const CATEGORY_MODELS = 'models';
const CATEGORY_DIRECTIVES = 'directives';
const CATEGORY_PLAINTEXT = 'plainText';
const CATEGORY_SYMBOLS = 'symbols';

// Misma lista de palabras clave que usa la gramática (syntax/sb4.tm-language.json).
export const KEYWORDS = new Set([
	'and', 'array', 'as', 'alloc', 'boolean', 'bool', 'break', 'case', 'cdecl', 'class', 'const',
	'continue', 'dec', 'define', 'default', 'div', 'downto', 'else', 'end', 'enum', 'export',
	'false', 'float', 'for', 'from', 'function', 'handle', 'hex', 'if', 'import', 'inc', 'int',
	'integer', 'logical', 'longstring', 'mul', 'not', 'of', 'optional', 'or', 'random', 'readmem',
	'repeat', 'return', 'shortstring', 'string', 'stdcall', 'sqr', 'switch', 'then', 'thiscall',
	'to', 'true', 'unknown', 'until', 'var', 'while', 'writemem'
]);

// Estructuras condicionales / de decisión (if/then/else, switch/case).
// AND/OR también van aquí: dentro de un IF (if ... and ... / or ...) deben
// colorearse como keywordsIf, como el resto de la condición.
//
// Incluye también los SALTOS CONDICIONALES tanto de SA normal como de su
// contraparte SBL (004D jump_if_false = goto_if_false = jf): una línea legacy
// "004D: jump_if_false @LABEL" debe colorearse junto con el IF.
export const KEYWORDS_IF = new Set([
	'if', 'then', 'else', 'elsif', 'endif', 'end', 'and', 'or', 'ifnot',
	'jf', 'jump_if_false', 'goto_if_false', 'else_jump', 'goto_if_true',
	'gosub_if_false', 'return_if_false'
]);

// Estructuras de decisión múltiple.
export const KEYWORDS_SWITCH = new Set([
	'switch', 'case', 'default', 'endswitch'
]);

// Bucles y saltos de control (while/for/repeat/until + break/continue/return).
// 'jump'/'goto' (0002), 'gosub' (0050) y las formas compuestas (whilenot,
// endwhile, return_true/false) se colorean aquí: son saltos de control del
// mismo bloque, tanto en SA normal como en SBL.
export const KEYWORDS_LOOP = new Set([
	'while', 'for', 'repeat', 'until', 'do', 'downto', 'from', 'to',
	'break', 'continue', 'return',
	'whilenot', 'endwhile', 'jump', 'goto', 'gosub', 'return_true', 'return_false'
]);

// Constantes booleanas.
export const KEYWORDS_BOOLEAN = new Set([
	'true', 'false'
]);

// Palabras reservadas ESTRUCTURALES (control de flujo): no se pueden usar
// como nombre de variable. Deliberadamente NO se incluye el set genérico
// KEYWORDS: esa es la lista de resaltado e incluye tipos/operadores que sanny
// acepta igual como identificador (p.ej. "int handle" compila — handle no es
// reservada). Una variable declarada con uno de estos nombres se marca como
// error de diagnóstico (ver collectReservedNames).
export const RESERVED = new Set([
	...KEYWORDS_IF,
	...KEYWORDS_SWITCH,
	...KEYWORDS_LOOP,
	...KEYWORDS_BOOLEAN
]);

const DIAGNOSTIC_SOURCE = 'SB4';
const DIAGNOSTIC_CODE = 'reserved-variable-name';

// Símbolos de programación (operadores de comparación/asignación/aritméticos).
const symbolRe = /==|!=|>=|<=|[+\-*/<>=]/g;

// Identificadores dentro de listas de nombres (constante compartida; se
// resetea lastIndex antes de cada uso).
const nameListRe = /[A-Za-z_]\w*/g;

// Tipos de variable de SB4 y PATRONES de declaración tipada: "int 0@",
// "float speed", "int VAR1, VAR2, VAR3" (lista coma-separada), bloque
// "var ... end" con "nombre: tipo" y "[var nombre: tipo]".
// El NOMBRE declarado se recuerda por documento y cada uso posterior se colorea
// como variable (los nombres numéricos 0@/$var ya se colorean por token).
const DECL_TYPES = '(?:int|float|double|bool|boolean|char|integer|long|short|longstring|shortstring|string|byte|word|dword|array|struct|handle)';
// "int speed" / "int VAR1, VAR2, VAR3, VAR4, VAR5" — tipo seguido de UNA lista
// de nombres separada por comas. El grupo 2 es el resto de la lista; el
// lookahead excluye keywords/tipos como falso-nombre (p. ej. "int end" no
// debe declarar "end").
const DECL_TYPE_NAME_RE = new RegExp(`\\b${DECL_TYPES}\\b\\s+(?!(?:var|end|${DECL_TYPES})\\b)([A-Za-z_]\\w*)((?:\\s*,\\s*[A-Za-z_]\\w*)*)`, 'g');
// "  speed: int", "  speed = 0.0: float", "  VAR1, VAR2 = 0 : int" — dentro de
// bloques var ... end. Con lookahead hasta ": <tipo>", TODOS los nombres de la
// lista (comas) se capturan; el prefijo no permite keywords/tipos como
// falso-nombre y `(?:^|,)\s*` exige un límite previo (un '$' delante → no
// matchea "global" de "$global").
const DECL_NAME_TYPE_RE = new RegExp(`(?:^|[,;])\\s*(?!(?:var|end|${DECL_TYPES})\\b)([A-Za-z_]\\w*)(?=[^:\\n]*:\\s*${DECL_TYPES}\\b)`, 'g');
// "[var speed: int]" / "[var a, b: int]" — anotación de variables de la
// extensión (los nombres se separan por coma).
const DECL_BRACKET_RE = /\[var\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:/gi;

// ~0: el análisis es incremental (por línea) y cada tecla se repinta al
// instante; el debounce solo evita hacer trabajo redundante dentro de una
// misma ráfaga de tipeo.
const DEBOUNCE_MS = 16;

// Cuando cambia una DECLARACIÓN tipada (int VAR1, name: int...), el conjunto
// declarado del documento entero cambió y hay que re-clasificar otras líneas.
// Esas tiradas se reagrupan con este debounce: tipear "int VAR1, VAR2, ..."
// produce UNA sola re-clasificación completa en lugar de una por tecla.
const DECLARE_DEBOUNCE_MS = 150;

/**
 * Colorea la sintaxis del lenguaje SB usando un esquema de colores definido
 * por el usuario en un archivo .ini de tema (sección [syntax]).
 *
 * A diferencia de la gramática TextMate (que solo colorea keywords y
 * comentarios), aquí se usan "decorations" de VS Code calculadas con el
 * Tokenizer + los datos reales de la librería (opcodes, clases y enums),
 * así cada categoría (keywords, números, strings, clases, comandos, enums,
 * variables, labels, comentarios, directivas...) se pinta con el color que
 * el usuario haya elegido en su .ini.
 *
 * Rendimiento: el documento se analiza POR LÍNEA (el estado de comentarios
 * de bloque/llaves se arrastra línea a línea) y cada edición de una sola
 * línea re-analiza SOLO esa línea (y, si cambió la continuidad de un
 * comentario, las siguientes hasta que el estado se re-estabiliza). Así el
 * coloreo es instantáneo incluso en archivos enormes (main.scm de 44k líneas).
 */
export class SyntaxColoringProvider extends Singleton {
	private baseProvider: BaseProvider = BaseProvider.getInstance();
	private colorManager: SyntaxColorManager = SyntaxColorManager.getInstance();
	private decorations = new Map<string, vscode.TextEditorDecorationType>();
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private declTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private paints = new Map<string, DocPaint>();

	// Variables NOMBRADAS declaradas con tipo (int speed, bloque var...end,
	// [var x: int]) por documento (uri → nombres en minúsculas). Se siembran en
	// el análisis completo y se actualizan en ediciones incrementales.
	private declaredVars = new Map<string, Set<string>>();

	private memberNames = new Set<string>();
	private className = new Set<string>();
	private enumNames = new Set<string>();
	private opcodeNames = new Set<string>();

	// Errores de "variable declarada con palabra reservada" (int goto, var
	// jf: int, [var end: int]...). Se re-setean en cada re-análisis completo.
	private diagnosticCollection = vscode.languages.createDiagnosticCollection('sb4-reserved-name');

	public async init() {
		this.colorManager.init(this.baseProvider.context, () => { void this.reload(); });
		await this.colorManager.reload();
		this.buildLookups();
		this.rebuildDecorations();
		this.registerListeners();
		this.applyToVisibleEditors();
	}

	public async reload() {
		await this.colorManager.reload();
		this.buildLookups();
		this.rebuildDecorations();
		this.paints.clear();
		this.applyToVisibleEditors();
	}

	private buildLookups() {
		// La categoría "commands" colorea SOLO los métodos de clase (el miembro
		// de "char.IsInAir" / "camera.Shake"), no los nombres sueltos de
		// opcodes (wait, load_scene, create_char) que van sin color.
		//
		// Fallback integrado: si la librería del juego no está cargada (falta
		// carpeta/versión de SB4 en la statusbar), las clases (Text, Char,
		// Car...) y su método "X.Y" siguen coloreándose/completándose. La
		// librería REAL, si cargan, se fusiona por encima del fallback.
		this.memberNames.clear();
		this.opcodeNames.clear();

		for (const members of Object.values(BUILTIN_CLASS_MEMBERS)) {
			for (const member of members) {
				this.memberNames.add(member.toLowerCase());
			}
		}

		for (const command of CommandManager.getInstance().getCommands().values()) {
			if (command.member) {
				this.memberNames.add(command.member.toLowerCase());
			}
			if (command.name) {
				this.opcodeNames.add(command.name.toLowerCase());
			}
		}

		// Clases: siembra con el fallback integrado y luego se fusionan las
		// clases reales del juego (sa.json).
		this.className.clear();
		for (const name of BUILTIN_CLASSES) {
			this.className.add(name.toLowerCase());
		}
		for (const name of ClassProvider.getInstance().get().keys()) {
			this.className.add(name.toLowerCase());
		}

		this.enumNames.clear();
		for (const [enumName, elements] of EnumProvider.getInstance().get()) {
			this.enumNames.add(enumName.toLowerCase());
			for (const element of elements) {
				this.enumNames.add(element.name.toLowerCase());
			}
		}
	}

	private registerListeners() {
		this.baseProvider.context.subscriptions.push(
			this.diagnosticCollection,
			vscode.workspace.onDidOpenTextDocument(doc => this.apply(doc)),
			vscode.workspace.onDidChangeTextDocument(event => this.scheduleIncremental(event)),
			vscode.workspace.onDidCloseTextDocument(doc => {
				this.clearTimer(doc.uri.toString());
				this.clearDeclTimer(doc.uri.toString());
				this.paints.delete(doc.uri.toString());
				this.declaredVars.delete(doc.uri.toString());
				this.diagnosticCollection.delete(doc.uri);
			}),
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (this.isSbEditor(editor)) {
					this.applyToEditor(editor);
				}
			}),
			vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => {
				if (this.isSbEditor(editor)) {
					this.applyToEditor(editor);
				}
			})),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('sb4.colors')) {
					void this.reload();
				}
			})
		);
	}

	private isSbEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
		return editor?.document.languageId === CONFIG.LANGUAGE_SELECTOR.language;
	}

	// Aplica el coloreo inmediatamente (sin debounce) para un documento SB.
	private apply(document: vscode.TextDocument) {
		if (document.languageId !== CONFIG.LANGUAGE_SELECTOR.language) {
			return;
		}
		this.getPaint(document);
		this.paintEditors(document.uri);
	}

	private scheduleIncremental(event: vscode.TextDocumentChangeEvent) {
		if (event.document.languageId !== CONFIG.LANGUAGE_SELECTOR.language) {
			return;
		}

		const key = event.document.uri.toString();
		const paint = this.paints.get(key);

		// Cambios ESTRUCTURALES (insertar/borrar líneas, pegar un bloque con
		// saltos de línea): las decoration del texto previo quedan ancladas a
		// sus offsets viejos y, mientras corre el debounce, se estiran sobre
		// el texto NUEVO con colores incorrectos (ej. el pegado que parece
		// "todo rojo" y luego se corrige). Repintar DE INMEDIATO elimina esa
		// ventana; la rapidez se mantiene porque el análisis completo ya es el
		// que tocaría hacer igualmente 16 ms después.
		if (paint &&
			(event.document.lineCount !== paint.lines.length ||
				event.contentChanges.some(ch => ch.range.start.line !== ch.range.end.line || /[\r\n]/.test(ch.text)))) {
			this.clearTimer(key);
			this.repaintChangedDocument(event);
			return;
		}

		this.clearTimer(key);
		this.debounceTimers.set(key, setTimeout(() => {
			this.debounceTimers.delete(key);
			this.repaintChangedDocument(event);
		}, DEBOUNCE_MS));
	}

	private clearTimer(key: string) {
		const existing = this.debounceTimers.get(key);
		if (existing) {
			clearTimeout(existing);
			this.debounceTimers.delete(key);
		}
	}

	private clearDeclTimer(key: string) {
		const existing = this.declTimers.get(key);
		if (existing) {
			clearTimeout(existing);
			this.declTimers.delete(key);
		}
	}

	/**
	 * Agrupa la re-clasificación completa tras editar una declaración: tipear
	 * "int VAR1, VAR2, ..." dispara una sola al parar de escribir.
	 */
	private scheduleDeclarationRepaint(document: vscode.TextDocument, key: string) {
		this.clearDeclTimer(key);
		this.declTimers.set(key, setTimeout(() => {
			this.declTimers.delete(key);
			const paint = this.paints.get(key);
			if (paint) {
				this.fullRepaint(document, key);
			}
		}, DECLARE_DEBOUNCE_MS));
	}

	// ------------------------------------------------------------------
	// Pintado
	// ------------------------------------------------------------------

	private applyToVisibleEditors() {
		vscode.window.visibleTextEditors.forEach(editor => {
			if (this.isSbEditor(editor)) {
				this.applyToEditor(editor);
			}
		});
	}

	/**
	 * Colorea (o recolorea) EL editor dado. Público: también se usa para
	 * repintar la pestaña virtual justo después de que setTextDocumentLanguage
	 * hace efectivo el language 'sannybuilder' (ahí no se emite ningún otro
	 * evento que dispare la reaplicación).
	 */
	public applyToEditor(editor: vscode.TextEditor) {
		const paint = this.getPaint(editor.document);
		for (const [category, decorationType] of this.decorations) {
			editor.setDecorations(decorationType, paint.catRanges.get(category) ?? []);
		}
	}

	private getPaint(document: vscode.TextDocument): DocPaint {
		let paint = this.paints.get(document.uri.toString());
		if (!paint) {
			paint = this.analyze(document.getText(), document.uri.toString());
			this.paints.set(document.uri.toString(), paint);
		}
		return paint;
	}

	private paintEditors(uri: vscode.Uri, paint?: DocPaint) {
		const target = paint ?? this.paints.get(uri.toString());
		if (!target) {
			return;
		}
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === uri.toString()) {
				for (const [category, decorationType] of this.decorations) {
					editor.setDecorations(decorationType, target.catRanges.get(category) ?? []);
				}
			}
		}
	}

	private rebuildDecorations() {
		for (const decorationType of this.decorations.values()) {
			decorationType.dispose();
		}
		this.decorations.clear();

		if (!vscode.workspace.getConfiguration('sb4').get<boolean>('colors.enabled', true)) {
			return;
		}

		for (const category of this.colorManager.getCategories()) {
			this.decorations.set(category, this.createDecoration(this.colorManager.getStyle(category)));
		}
	}

	private createDecoration(style: SyntaxColorStyle): vscode.TextEditorDecorationType {
		const textDecorations: string[] = [];
		if (style.underline) {
			textDecorations.push('underline');
		}
		if (style.strikethrough) {
			textDecorations.push('line-through');
		}

		return vscode.window.createTextEditorDecorationType({
			color: style.color,
			fontWeight: style.bold ? 'bold' : undefined,
			fontStyle: style.italic ? 'italic' : undefined,
			textDecoration: textDecorations.length ? textDecorations.join(' ') : undefined
		});
	}

	// ------------------------------------------------------------------
	// Análisis por línea (full e incremental compartido)
	// ------------------------------------------------------------------

	// Analiza el documento completo, línea a línea, arrastrando el estado de
	// comentarios de bloque/llaves. Devuelve el "render" agregado. `docKey`
	// identifica el documento para la lista de variables declaradas (int/float).
	private analyze(text: string, docKey: string): DocPaint {
		this.declaredVars.set(docKey, this.collectDeclaredVars(text));
		this.updateReservedDiagnostics(docKey, this.collectReservedNames(text));
		const declared = this.declaredVars.get(docKey)!;

		const pieces = text.split(/\r?\n/);
		const lines: LineRender[] = [];
		let inBlock = false;
		let inBrace = false;
		let prevDot = false;

		for (let lineIndex = 0; lineIndex < pieces.length; lineIndex++) {
			const render = this.analyzeLine(pieces[lineIndex], inBlock, inBrace, prevDot, declared);
			inBlock = render.blockOut;
			inBrace = render.braceOut;
			prevDot = render.endsWithDot;
			lines.push(render);
		}

		const paint: DocPaint = { lines, catRanges: new Map() };
		this.rebuildAggregate(paint);
		return paint;
	}

	/**
	 * Reconstruye las ranges ABSOLUTAS (vscode.Range) a partir de los renders
	 * por línea (rangos relativos). Ligero: no re-tokeniza; solo recoloca los
	 * rangos sobre la grilla actual de líneas (necesario tras insertar/borrar
	 * líneas, que desplaza el número de línea de todo lo que está debajo).
	 */
	private rebuildAggregate(paint: DocPaint) {
		const catRanges = new Map<string, vscode.Range[]>();
		const lines = paint.lines;
		for (let li = 0; li < lines.length; li++) {
			const render = lines[li];
			for (const [category, rels] of render.categories) {
				let arr = catRanges.get(category);
				if (!arr) {
					arr = [];
					catRanges.set(category, arr);
				}
				for (const rel of rels) {
					arr.push(new vscode.Range(li, rel[0], li, rel[1]));
				}
			}
		}
		paint.catRanges = catRanges;
	}

	private absoluteRanges(lineIndex: number, rels: [number, number][]): vscode.Range[] {
		const out: vscode.Range[] = [];
		for (const rel of rels) {
			out.push(new vscode.Range(lineIndex, rel[0], lineIndex, rel[1]));
		}
		return out;
	}

	/**
	 * Analiza UNA línea y devuelve sus rangos relativos por categoría (start/
	 * end dentro de la línea, sin número de línea) + el estado de "comentario
	 * abierto" que deja (para la siguiente línea) + si termina en un '.'.
	 * `blockIn`/`braceIn` indican si la línea arranca DENTRO de un comentario
	 * de bloque (/* *\/) o de llaves ({ ... }) heredado de la línea anterior;
	 * `prevDot` si la línea anterior terminó con un punto (acceso Text.Draw
	 * repartido en dos líneas). Guarda el texto y el estado de ENTRADA en el
	 * render para poder REUTILIZARLA intacta en una edición estructural (el
	 * estado de entrada debe coincidir de nuevo para que la reutilización sea
	 * válida).
	 */
	private analyzeLine(
		lineText: string,
		blockIn: boolean,
		braceIn: boolean,
		prevDot: boolean,
		declared: Set<string>
	): LineRender {
		const categories = new Map<string, [number, number][]>();
		const exclusions: { start: number; end: number }[] = [];

		const add = (category: string, localStart: number, localEnd: number) => {
			let arr = categories.get(category);
			if (!arr) {
				arr = [];
				categories.set(category, arr);
			}
			arr.push([localStart, localEnd]);
		};
		const exclude = (localStart: number, localEnd: number) => {
			exclusions.push({ start: localStart, end: localEnd });
		};
		const addExcluded = (category: string, localStart: number, localEnd: number) => {
			add(category, localStart, localEnd);
			exclude(localStart, localEnd);
		};

		// --- Comentarios (//, /* */, {...}) — reconocidos por escáner para
		// poder arrastrar el estado entre líneas (los bloque/llaves pueden
		// abrir en una línea y cerrar 500 líneas después). Los openers se
		// incluyen en el rango del comentario (/*, {).
		let restBlock = blockIn;
		let restBrace = braceIn;
		let blockOut = blockIn;
		let braceOut = braceIn;
		let blockOpenAt = -1;
		let braceOpenAt = -1;
		let i = 0;
		const len = lineText.length;

		while (i < len) {
			if (restBlock) {
				const start = blockOpenAt >= 0 ? blockOpenAt : i;
				const close = lineText.indexOf('*/', i);
				if (close === -1) {
					addExcluded(CATEGORY_COMMENTS, start, len);
					blockOut = true;
					break;
				}
				addExcluded(CATEGORY_COMMENTS, start, close + 2);
				restBlock = false;
				blockOut = false;
				blockOpenAt = -1;
				i = close + 2;
				continue;
			}
			if (restBrace) {
				const start = braceOpenAt >= 0 ? braceOpenAt : i;
				const close = lineText.indexOf('}', i);
				if (close === -1) {
					addExcluded(CATEGORY_COMMENTS, start, len);
					braceOut = true;
					break;
				}
				addExcluded(CATEGORY_COMMENTS, start, close + 1);
				restBrace = false;
				braceOut = false;
				braceOpenAt = -1;
				i = close + 1;
				continue;
			}
			if (lineText[i] === '/' && lineText[i + 1] === '/') {
				addExcluded(CATEGORY_COMMENTS, i, len);
				break;
			}
			if (lineText[i] === '/' && lineText[i + 1] === '*') {
				restBlock = true;
				blockOut = true;
				blockOpenAt = i;
				i += 2;
				// Opener al FINAL de la línea ("/*" como única cosa): el bucle
				// sale sin poder pintarlo en la siguiente pasada, así que se
				// pinta aquí (desde el opener hasta el final de la línea).
				if (i >= len) {
					addExcluded(CATEGORY_COMMENTS, blockOpenAt, len);
					break;
				}
				continue;
			}
			if (lineText[i] === '{' && lineText[i + 1] !== '$') {
				restBrace = true;
				braceOut = true;
				braceOpenAt = i;
				i += 1;
				// Opener al FINAL de la línea ("{"): idem al de comentario de
				// bloque, el bucle saldría sin añadir el rango.
				if (i >= len) {
					addExcluded(CATEGORY_COMMENTS, braceOpenAt, len);
					break;
				}
				continue;
			}
			i++;
		}

		// --- Strings (solo como bloqueadores de símbolos; los tokens de
		// strings se pintan con el tokenizer).
		const stringRe = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
		const symbolBlockers: { start: number; end: number }[] = [];
		stringRe.lastIndex = 0;
		for (const match of lineText.matchAll(stringRe)) {
			const start = match.index ?? 0;
			symbolBlockers.push({ start, end: start + match[0].length });
		}

		// --- Números NEGATIVOS: el signo '-' ya lo incluye el token del número
		// (categoría numbers); se bloquea para que el pasaje de symbols no lo
		// repinte encima como operador de resta.
		const signedNumberRe = /-\d+(?:\.\d+)?|-\.\d+/g;
		signedNumberRe.lastIndex = 0;
		for (const match of lineText.matchAll(signedNumberRe)) {
			const start = match.index ?? 0;
			symbolBlockers.push({ start, end: start + match[0].length });
		}

		// --- Números hexadecimales (0x...) — se excluyen del tokenizer para
		// que no repinte el dígito suelto "0".
		const hexRe = /\b0x[0-9A-Fa-f]+\b/g;
		hexRe.lastIndex = 0;
		for (const match of lineText.matchAll(hexRe)) {
			const start = match.index ?? 0;
			addExcluded(CATEGORY_NUMBERS, start, start + match[0].length);
		}

		// --- Directivas: {$...}
		const directiveRe = /\{\$[^}\n]*\}/g;
		directiveRe.lastIndex = 0;
		for (const match of lineText.matchAll(directiveRe)) {
			const start = match.index ?? 0;
			addExcluded(CATEGORY_DIRECTIVES, start, start + match[0].length);
		}

		// --- Dirección de opcode al inicio: texto base (plainText), nunca
		// command (solo los métodos de clase, char.IsInAir, llevan commands).
		const addressMatch = /^(\s*[0-9A-Fa-f]{2,4}\s*:)/.exec(lineText);
		if (addressMatch) {
			addExcluded(CATEGORY_PLAINTEXT, 0, addressMatch[1].length);
		}

		// --- Declaraciones [var nombre: Tipo] (nombre puede ser "0@", "$var"
		// o identificador; "var" en mayúsculas o minúsculas).
		const varDeclRe = /\[var\s+([^\s:]+?)\s*:\s*([A-Za-z_]\w*)\]/gi;
		varDeclRe.lastIndex = 0;
		for (const match of lineText.matchAll(varDeclRe)) {
			const start = match.index ?? 0;
			const end = start + match[0].length;
			exclude(start, end);

			const nameOffset = start + match[0].indexOf(match[1]);
			add(CATEGORY_VARIABLES, nameOffset, nameOffset + match[1].length);

			const typeOffset = start + match[0].lastIndexOf(match[2]);
			add(CATEGORY_CLASSES, typeOffset, typeOffset + match[2].length);
		}

		exclusions.sort((a, b) => a.start - b.start);

		// --- Símbolos de programación (==, =, >, <, +, -, *, /...). Se
		// saltean comentarios, directivas, hex, dirección, [var...] y strings.
		symbolBlockers.push(...exclusions);
		symbolBlockers.sort((a, b) => a.start - b.start);

		symbolRe.lastIndex = 0;
		let blockerIdx = 0;
		for (const match of lineText.matchAll(symbolRe)) {
			const start = match.index ?? 0;
			const end = start + match[0].length;

			while (blockerIdx < symbolBlockers.length && symbolBlockers[blockerIdx].end <= start) {
				blockerIdx++;
			}
			if (blockerIdx < symbolBlockers.length && symbolBlockers[blockerIdx].start < end) {
				continue;
			}

			add(CATEGORY_SYMBOLS, start, end);
		}

		// --- Tokens principales (solo esta línea; el estado cruzado lo
		// arrastran blockIn/braceIn/prevDot).
		const tokens = new Tokenizer().tokenize(lineText);
		let exclIdx = 0;
		let prev: Token | undefined;

		for (const token of tokens) {
			if (token.kind === TokenKind.NewLine || token.kind === TokenKind.EOF) {
				continue;
			}

			const start = token.col;
			const end = start + token.text.length;

			while (exclIdx < exclusions.length && exclusions[exclIdx].end <= start) {
				exclIdx++;
			}
			if (exclIdx < exclusions.length && exclusions[exclIdx].start < end) {
				prev = token;
				continue;
			}

			const dotBefore = prev ? prev.kind === TokenKind.Dot : prevDot;
			const category = this.classifyToken(token, dotBefore, declared);
			if (category) {
				add(category, start, end);
			}

			prev = token;
		}

		return {
			text: lineText,
			categories,
			blockIn,
			braceIn,
			prevDotIn: prevDot,
			blockOut,
			braceOut,
			endsWithDot: prev?.kind === TokenKind.Dot
		};
	}

	private classifyToken(token: Token, dotBefore: boolean, declared: Set<string>): string | undefined {
		switch (token.kind) {
			case TokenKind.Number:
			case TokenKind.Float:
				return CATEGORY_NUMBERS;

			case TokenKind.String:
				return CATEGORY_STRINGS;

			case TokenKind.GlobalVar:
			case TokenKind.LocalVar:
				return CATEGORY_VARIABLES;

			case TokenKind.LabelJump:
			case TokenKind.LabelDefine:
				return CATEGORY_LABELS;

			case TokenKind.Model:
				// #ESPERANT, #AK47... referencias a modelos/constantes (#prefijo).
				return CATEGORY_MODELS;

			case TokenKind.Dot:
				// Operador de acceso (char.IsInAir) — siempre texto base.
				return CATEGORY_PLAINTEXT;

			case TokenKind.Identifier: {
				const word = token.text.toLowerCase();

				if (KEYWORDS_IF.has(word)) {
					// Condicionales y cierre de estructuras (if/then/else/end).
					return CATEGORY_KEYWORDS_IF;
				}

				if (KEYWORDS_SWITCH.has(word)) {
					// Estructuras de decisión múltiple (switch/case/default).
					return CATEGORY_KEYWORDS_SWITCH;
				}

				if (KEYWORDS_LOOP.has(word)) {
					// Bucles y saltos de control (while/for/repeat/until...).
					return CATEGORY_KEYWORDS_LOOP;
				}

				if (KEYWORDS_BOOLEAN.has(word)) {
					// Constantes booleanas.
					return CATEGORY_KEYWORDS_BOOLEAN;
				}

				if (KEYWORDS.has(word)) {
					return CATEGORY_KEYWORDS;
				}

				// Variable declarada con su tipo (int speed, bloque var...end,
				// [var x: int]): TODO uso (declaración + usos posteriores) se
				// mantiene como variable aunque el token sea un identificador
				// común, sin importar que coincida con opcodes/clases/enums.
				if (declared.has(word)) {
					return CATEGORY_VARIABLES;
				}

				// Nombres sueltos de opcodes (wait, goto, load_scene,
				// create_char...) van como texto base, no como commands/enums.
				if (this.opcodeNames.has(word)) {
					return CATEGORY_PLAINTEXT;
				}

				// Los métodos de clase (member) SOLO se colorean como commands
				// cuando son acceso real: char.IsInAir. Un miembro suelto
				// (jump, IsInAir...) es un nombre de opcode → texto base.
				//
				// ORDEN IMPORTANTE: la clase se chequea ANTES que el miembro.
				// Hay miembros cuyo nombre coincide con una CLASE (File,
				// Restart, Text: p.ej. ImGui.IMGUI_TEXT → member "Text") y si
				// el miembro se chequease primero, un 'Text' suelto (uso de
				// clase) caería a plainText. Como clase, el nombre suelto se
				// colorea siempre; solo tras un '.' se colorea como command.
				if (this.className.has(word)) {
					return CATEGORY_CLASSES;
				}

				if (this.memberNames.has(word)) {
					return dotBefore ? CATEGORY_COMMANDS : CATEGORY_PLAINTEXT;
				}

				if (this.enumNames.has(word)) {
					return CATEGORY_ENUMS;
				}

				// Texto base sin relación con objetos (nombres de opcodes
				// sueltos como wait/load_scene/create_char, etc.).
				return CATEGORY_PLAINTEXT;
			}

			default:
				return undefined;
		}
	}

	// ------------------------------------------------------------------
	// Variables declaradas con tipo (int/float/...): extracción por documento
	// ------------------------------------------------------------------

	/**
	 * Devuelve la línea con el contenido de comentarios REEMPLAZADO por
	 * espacios (misma longitud), para que las regex de declaración nunca
	 * matcheen dentro de un comentario. El estado de comentarios de bloque
	 * (`/* ... *\/` y `{ ... }`) se arrastra entre líneas.
	 */
	private commentFree(line: string, state: { block: boolean; brace: boolean }): string {
		const out = new Array(line.length);
		let i = 0;
		const len = line.length;

		while (i < len) {
			const ch = line[i];
			const next = line[i + 1];

			if (state.block) {
				out[i] = ' ';
				if (ch === '*' && next === '/') {
					out[i + 1] = ' ';
					i += 2;
					state.block = false;
					continue;
				}
				i++;
				continue;
			}

			if (state.brace) {
				out[i] = ' ';
				if (ch === '}') {
					state.brace = false;
					i++;
					continue;
				}
				i++;
				continue;
			}

			if (ch === '/' && next === '/') {
				while (i < len) {
					out[i] = ' ';
					i++;
				}
				break;
			}

			if (ch === '/' && next === '*') {
				out[i] = ' ';
				out[i + 1] = ' ';
				i += 2;
				state.block = true;
				continue;
			}

			if (ch === '{' && next !== '$') {
				out[i] = ' ';
				state.brace = true;
				i++;
				continue;
			}

			out[i] = ch;
			i++;
		}

		return out.join('');
	}

	/** Nombres declarados en UNA línea (sin estado cruzado de comentarios). */
	private lineDeclarations(line: string): Set<string> {
		const names = new Set<string>();
		const state = { block: false, brace: false };
		const cleaned = this.commentFree(line, state);
		for (const name of this.declaredNamesInLine(cleaned)) {
			names.add(name);
		}
		for (const name of this.declaredInVarNamesInLine(cleaned)) {
			names.add(name);
		}
		return names;
	}

	/**
	 * Reúne los nombres (lowercase) declarados en una línea ya libre de
	 * comentarios con el tipo DELANTE (tipo + lista coma-separada) y las
	 * anotaciones [var a, b: tipo].
	 */
	private declaredNamesInLine(cleaned: string): string[] {
		const names: string[] = [];

		DECL_TYPE_NAME_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_TYPE_NAME_RE)) {
			names.push(m[1].toLowerCase());
			const tail = m[2] ?? '';
			const tailNamesRe = /[A-Za-z_]\w*/g;
			tailNamesRe.lastIndex = 0;
			for (const t of tail.matchAll(tailNamesRe)) {
				names.push(t[0].toLowerCase());
			}
		}

		DECL_BRACKET_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_BRACKET_RE)) {
			for (const n of m[1].split(',')) {
				const name = n.trim();
				if (name) {
					names.push(name.toLowerCase());
				}
			}
		}

		return names;
	}

	/**
	 * Nombres en el estilo "nombre [: inicializador] : <tipo>" propio del
	 * bloque `var ... end` (incluye listas "VAR1, VAR2 = 0 : int").
	 */
	private declaredInVarNamesInLine(cleaned: string): string[] {
		const names: string[] = [];
		DECL_NAME_TYPE_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_NAME_TYPE_RE)) {
			names.push(m[1].toLowerCase());
		}
		return names;
	}

	private sameDeclarations(a: string, b: string): boolean {
		const sa = this.lineDeclarations(a);
		const sb = this.lineDeclarations(b);
		if (sa.size !== sb.size) {
			return false;
		}
		for (const name of sa) {
			if (!sb.has(name)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Barre TODO el documento y reúne los nombres de variables declaradas con
	 * tipo. Reconoce:
	 *  - "int speed" / "float 0@" / "int VAR1, VAR2, VAR3" (tipo + nombres);
	 *  - "  speed: int" dentro de un bloque `var ... end` (incl. `0@: int = 5`,
	 *    listas "VAR1, VAR2 = 0 : int");
	 *  - "[var speed: int]" (anotación de esta extensión).
	 * Respeta comentarios //, de llaves y de bloque (con estado arrastrado).
	 */
	private collectDeclaredVars(text: string): Set<string> {
		const names = new Set<string>();
		const lines = text.split(/\r?\n/);
		const state = { block: false, brace: false };
		let inVar = false;

		for (const line of lines) {
			const cleaned = this.commentFree(line, state);
			const trimmed = cleaned.trim();

			if (/^var\b/i.test(trimmed)) {
				inVar = true;
			}

			for (const name of this.declaredNamesInLine(cleaned)) {
				names.add(name);
			}

			if (inVar) {
				for (const name of this.declaredInVarNamesInLine(cleaned)) {
					names.add(name);
				}
			}

			if (/\bend\b/i.test(trimmed)) {
				inVar = false;
			}
		}

		return names;
	}

	// ------------------------------------------------------------------
	// Variables declaradas con palabras reservadas (diagnóstico)
	// ------------------------------------------------------------------

	/**
	 * Marca como ERROR de diagnóstico cualquier variable declarada con un
	 * nombre que sea una palabra reservada de SBL (int goto, "goto = 0: int",
	 * [var jf: int]...). Los regex de declaración excluyen var/end/tipos como
	 * falso-nombre, pero palabras como if/goto/jf/while sí entran como nombre
	 * y no pueden usarse como variable.
	 *
	 * Sigue la MISMA pasada (commentFree + estado de bloques var...end) que
	 * collectDeclaredVars, para detectar exactamente lo que el coloreo
	 * considera una declaración.
	 */
	private collectReservedNames(text: string): ReservedUsage[] {
		const usages: ReservedUsage[] = [];
		const lines = text.split(/\r?\n/);
		const state = { block: false, brace: false };
		let inVar = false;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const cleaned = this.commentFree(lines[lineIndex], state);
			const trimmed = cleaned.trim();

			if (/^var\b/i.test(trimmed)) {
				inVar = true;
			}

			this.reservedDeclaredNamesInLine(cleaned, lineIndex, usages);
			if (inVar) {
				this.reservedVarNamesInLine(cleaned, lineIndex, usages);
			}

			if (/\bend\b/i.test(trimmed)) {
				inVar = false;
			}
		}

		return usages;
	}

	private pushReserved(usages: ReservedUsage[], lineIndex: number, index: number, name: string) {
		const word = name.toLowerCase();
		if (RESERVED.has(word)) {
			usages.push({ line: lineIndex, start: index, length: name.length, name: word });
		}
	}

	/** "int NAME, NAME2..." (tipo delante) y "[var NAME: tipo]". */
	private reservedDeclaredNamesInLine(cleaned: string, lineIndex: number, usages: ReservedUsage[]) {
		DECL_TYPE_NAME_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_TYPE_NAME_RE)) {
			const firstIndex = m.index + m[0].indexOf(m[1]);
			this.pushReserved(usages, lineIndex, firstIndex, m[1]);

			const tail = m[2] ?? '';
			if (tail) {
				const tailStart = m.index + m[0].indexOf(tail);
				nameListRe.lastIndex = 0;
				for (const t of tail.matchAll(nameListRe)) {
					this.pushReserved(usages, lineIndex, tailStart + t.index, t[0]);
				}
			}
		}

		DECL_BRACKET_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_BRACKET_RE)) {
			const list = m[1];
			const listStart = m.index + m[0].indexOf(list);
			nameListRe.lastIndex = 0;
			for (const n of list.matchAll(nameListRe)) {
				this.pushReserved(usages, lineIndex, listStart + n.index, n[0]);
			}
		}
	}

	/** "NAME [: inicializador] : tipo" dentro de bloques "var ... end". */
	private reservedVarNamesInLine(cleaned: string, lineIndex: number, usages: ReservedUsage[]) {
		DECL_NAME_TYPE_RE.lastIndex = 0;
		for (const m of cleaned.matchAll(DECL_NAME_TYPE_RE)) {
			const index = m.index + m[0].indexOf(m[1]);
			this.pushReserved(usages, lineIndex, index, m[1]);
		}
	}

	private updateReservedDiagnostics(docKey: string, usages: ReservedUsage[]) {
		if (usages.length === 0) {
			this.diagnosticCollection.delete(vscode.Uri.parse(docKey));
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		for (const u of usages) {
			const range = new vscode.Range(u.line, u.start, u.line, u.start + u.length);
			const diagnostic = new vscode.Diagnostic(
				range,
				`'${u.name}' es una palabra reservada y no puede usarse como nombre de variable.`,
				vscode.DiagnosticSeverity.Error
			);
			diagnostic.code = DIAGNOSTIC_CODE;
			diagnostic.source = DIAGNOSTIC_SOURCE;
			diagnostics.push(diagnostic);
		}
		this.diagnosticCollection.set(vscode.Uri.parse(docKey), diagnostics);
	}

	// ------------------------------------------------------------------
	// Pintado incremental (una tecla = una línea re-analizada)
	// ------------------------------------------------------------------

	/**
	 * Re-renderiza SOLO las líneas afectadas por el cambio. Para ediciones de
	 * una sola línea basta con re-analizar esa línea + (si cambió la
	 * continuidad de un comentario de bloque/llaves) las siguientes hasta que
	 * el estado se re-estabilize. Cambios estructurales (insertar/borrar
	 * líneas, saltos de línea) se resuelven en incrementos: se reconstruye la
	 * grilla reutilizando los renders de las líneas intactas.
	 */
	private repaintChangedDocument(event: vscode.TextDocumentChangeEvent) {
		const document = event.document;
		const key = document.uri.toString();
		const paint = this.paints.get(key);
		if (!paint) {
			return;
		}

		// Cambio estructural → repintado incremental (sin re-análisis completo).
		if (document.lineCount !== paint.lines.length ||
			event.contentChanges.some(ch => ch.range.start.line !== ch.range.end.line || /[\r\n]/.test(ch.text))) {
			this.repaintStructural(event, paint);
			return;
		}

		const changedLines = [...new Set(event.contentChanges.map(ch => ch.range.start.line))].sort((a, b) => a - b);
		const coveredLines = new Set<number>();
		const affectedCategories = new Set<string>();

		for (const lineIndex of changedLines) {
			if (coveredLines.has(lineIndex)) {
				continue;
			}

			// Si en la línea editada cambió una DECLARACIÓN tipada (se añadió,
			// quitó o renombró "int speed"), el nombre puede usarse en cualquier
			// otra línea → re-clasificación completa AGREGADA (una por ráfaga
			// de tipeo), no por tecla.
			if (!this.sameDeclarations(paint.lines[lineIndex].text, document.lineAt(lineIndex).text)) {
				this.scheduleDeclarationRepaint(document, key);
			}

			// Camina hacia adelante mientras el estado de comentarios cambie;
			// se detiene cuando una línea re-renderizada coincide con su estado
			// almacenado (las siguientes reciben el mismo estado de entrada).
			let inBlock = lineIndex > 0 ? paint.lines[lineIndex - 1].blockOut : false;
			let inBrace = lineIndex > 0 ? paint.lines[lineIndex - 1].braceOut : false;
			let prevDot = lineIndex > 0 ? paint.lines[lineIndex - 1].endsWithDot : false;
			let idx = lineIndex;
			const declared = this.declaredVars.get(key) ?? new Set<string>();

			while (idx < paint.lines.length) {
				const render = this.analyzeLine(document.lineAt(idx).text, inBlock, inBrace, prevDot, declared);
				const stored = paint.lines[idx];
				coveredLines.add(idx);

				// Sustituye los ranges agregados de esta línea y actualiza el
				// estado almacenado (así el pase siguiente ve el render nuevo).
				this.replaceLineRange(paint, idx, stored, render, affectedCategories);
				paint.lines[idx] = render;

				if (render.blockOut === stored.blockOut &&
					render.braceOut === stored.braceOut &&
					render.endsWithDot === stored.endsWithDot) {
					break;
				}

				if (idx + 1 >= paint.lines.length) {
					break;
				}

				inBlock = render.blockOut;
				inBrace = render.braceOut;
				prevDot = render.endsWithDot;
				idx++;
			}
		}

		this.paintCategories(document.uri, paint, affectedCategories);
	}

	private paintCategories(uri: vscode.Uri, paint: DocPaint, categories: Set<string>) {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() !== uri.toString()) {
				continue;
			}
			for (const category of categories) {
				const decoration = this.decorations.get(category);
				if (decoration) {
					editor.setDecorations(decoration, paint.catRanges.get(category) ?? []);
				}
			}
		}
	}

	// Sustituye en el índice dado el range de la AGGREGATED catRanges que
	// pertenecía a esa línea, evitando reconstruir categorías no afectadas.
	private replaceLineRange(
		paint: DocPaint,
		lineIndex: number,
		old: LineRender,
		neu: LineRender,
		affectedCategories: Set<string>
	) {
		const categoriesUnion = new Set<string>([...old.categories.keys(), ...neu.categories.keys()]);
		for (const category of categoriesUnion) {
			affectedCategories.add(category);
			const all = paint.catRanges.get(category);
			if (!all) {
				if (neu.categories.get(category)) {
					paint.catRanges.set(category, this.absoluteRanges(lineIndex, neu.categories.get(category)!));
				}
				continue;
			}
			const rebuilt = all.filter(r => r.start.line !== lineIndex);
			for (const rel of neu.categories.get(category) ?? []) {
				rebuilt.push(new vscode.Range(lineIndex, rel[0], lineIndex, rel[1]));
			}
			paint.catRanges.set(category, rebuilt);
		}
	}

	/**
	 * Cambio ESTRUCTURAL (insertar/borrar líneas, Enter, pegar con saltos):
	 * reconstruye la grilla de líneas reutilizando los renders intactos
	 * (solo se re-analizan las líneas de la región editada) y recoloca las
	 * ranges absolutas con rebuildAggregate. Evita el re-análisis completo de
	 * un archivo grande en cada tecla.
	 */
	private repaintStructural(event: vscode.TextDocumentChangeEvent, paint: DocPaint) {
		const document = event.document;
		const key = document.uri.toString();
		const declared = this.declaredVars.get(key) ?? new Set<string>();
		const oldLines = paint.lines;

		const first = event.contentChanges[0];
		const startLine = Math.min(first.range.start.line, document.lineCount - 1);
		const checkLine = startLine;
		const oldText = first.range.start.line < oldLines.length ? oldLines[first.range.start.line].text : undefined;

		// Si la línea editada declara variables, el conjunto declarado del
		// documento cambió → se agenda una re-clasificación completa (agrupada)
		// y se pinta igual la región con el set actual; la completa la corrige.
		if (oldText !== undefined && !this.sameDeclarations(oldText, document.lineAt(checkLine).text)) {
			this.scheduleDeclarationRepaint(document, key);
		}

		const netDelta = document.lineCount - oldLines.length;
		const newlineCount = (first.text.match(/\n/g) ?? []).length;
		const regionNewLines = newlineCount + 1;

		const newRender: (LineRender | null)[] = new Array(document.lineCount);
		for (let i = 0; i < Math.min(startLine, oldLines.length, document.lineCount); i++) {
			newRender[i] = oldLines[i];
		}
		for (let i = startLine; i < startLine + regionNewLines && i < document.lineCount; i++) {
			newRender[i] = null;
		}
		for (let i = startLine + regionNewLines; i < document.lineCount; i++) {
			const j = i - netDelta;
			newRender[i] = j >= 0 && j < oldLines.length ? oldLines[j] : null;
		}

		let firstChanged = -1;
		for (let i = 0; i < newRender.length; i++) {
			if (newRender[i] === null) {
				firstChanged = i;
				break;
			}
		}
		if (firstChanged === -1) {
			return;
		}

		let inBlock = firstChanged > 0 ? (newRender[firstChanged - 1] as LineRender).blockOut : false;
		let inBrace = firstChanged > 0 ? (newRender[firstChanged - 1] as LineRender).braceOut : false;
		let prevDot = firstChanged > 0 ? (newRender[firstChanged - 1] as LineRender).endsWithDot : false;

		for (let i = firstChanged; i < newRender.length; i++) {
			const stored = newRender[i];
			const text = document.lineAt(i).text;
			// Reutiliza el render viejo SOLO si recibe el mismo estado de
			// entrada que cuando se analizó y el texto coincide (la grilla
			// desplazada lo re-validó por posición).
			if (stored &&
				stored.blockIn === inBlock &&
				stored.braceIn === inBrace &&
				stored.prevDotIn === prevDot &&
				stored.text === text) {
				inBlock = stored.blockOut;
				inBrace = stored.braceOut;
				prevDot = stored.endsWithDot;
				continue;
			}
			const render = this.analyzeLine(text, inBlock, inBrace, prevDot, declared);
			newRender[i] = render;
			inBlock = render.blockOut;
			inBrace = render.braceOut;
			prevDot = render.endsWithDot;
		}

		paint.lines = newRender as LineRender[];
		this.rebuildAggregate(paint);
		this.paintEditors(document.uri);
	}

	private fullRepaint(document: vscode.TextDocument, key: string) {
		this.paints.set(key, this.analyze(document.getText(), key));
		this.paintEditors(document.uri);
	}

}

interface LineRender {
	text: string;
	categories: Map<string, [number, number][]>;
	blockIn: boolean;
	braceIn: boolean;
	prevDotIn: boolean;
	blockOut: boolean;
	braceOut: boolean;
	endsWithDot: boolean;
}

interface DocPaint {
	lines: LineRender[];
	catRanges: Map<string, vscode.Range[]>;
}

interface ReservedUsage {
	line: number;
	start: number;
	length: number;
	name: string;
}
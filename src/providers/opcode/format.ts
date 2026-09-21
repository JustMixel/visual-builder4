import { Command, CommandArgs } from '@utils';

/**
 * Formatea la línea de un opcode en estilo SBL (Sanny Builder 4). El código
 * (dirección) va COMENTADO entre llaves (`{00A5:}`) — SBL lo ignora, es solo
 * una ayuda visual; el compilador resuelve el opcode por el NOMBRE del comando.
 *
 * La SALIDA se escribe con la sintaxis SBL real, NO con corchetes:
 *
 *     {00A5:} int veh = create_car {modelId} [float] {x} [float] {y} [float] {z} [float]
 *
 * Reglas verificadas contra sanny real (sa_sbl):
 *  - Salida simple con nombre → tipo (`int`/`float`) + nombre: `int handle =`.
 *    Tipos de objeto (`Blip`, `Car`…) NO se usan como tipo de declaración: los
 *    ejemplos oficiales y la compilación los tratan como `int` (handles).
 *  - Salida simple sin nombre o var legacy (`0@`, `$x`) → el nombre tal cual,
 *    SIN tipo (`0@ =`).
 *  - Salida MÚLTIPLE → SBL NO admite lista de declaraciones (`float x, float y`
 *    da "= expected but y found"); se usan variables locales legacy:
 *    `0@, 1@, 2@ = get_char_coordinates $scplayer`.
 *
 * El `[var ... : Tipo] =` anterior NO es SBL válido ("Unknown directive") y
 * producía crashes al compilar/ejecutar.
 */
export function buildOpcodeLine(command: Command): string {
	const address = command.id ? `{${command.id}:}` : '';
	const output = formatOutput(command.output);
	const input = (command.input ?? []).map(a => formatOpcodeArg(a)).join(' ');
	return [address, output, command.name, input].filter(Boolean).join(' ').trimEnd();
}

function isLegacyVar(name: string): boolean {
	return /^\d+@$/.test(name) || name.startsWith('$');
}

/** Declaración SBL de una salida simple: `int handle` / `float speed` / `0@`. */
function formatOutputArg(arg: CommandArgs): string {
	const name = arg.name || '0@';
	if (isLegacyVar(name)) {
		return name;
	}
	const type = arg.type === 'float' ? 'float' : 'int';
	return `${type} ${name}`;
}

function formatOutput(output?: CommandArgs[]): string {
	if (!output || output.length === 0) {
		return '';
	}

	if (output.length === 1) {
		return `${formatOutputArg(output[0])} =`;
	}

	// Múltiples salidas: SBL no admite declaración múltiple; variables legacy.
	return output.map((_, i) => `${i}@`).join(', ') + ' =';
}

export function formatOpcodeArg(arg: CommandArgs): string {
	return [arg.name ? `{${arg.name}}` : '', arg.type ? `[${arg.type}]` : ''].filter(Boolean).join(' ');
}

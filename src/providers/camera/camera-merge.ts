import { Singleton, showInfoToast } from '@utils';
import * as vscode from 'vscode';
import { LocaleManager } from '@i18n';
import { BaseProvider } from '../base';

interface CameraLine {
    kind: 'pos' | 'point';
    x: string;
    y: string;
    z: string;
}

// Línea de cámara en sintaxis clásica:
//   015F: set_camera_position x y z rotation rx ry rz
//   0160: set_camera_point_at x y z mode n
const CAMERA_LINE_RE = /^\s*(015F|0160)\s*:/i;

/**
 * "Ctrl+Alt+M": fusiona DOS grupos de cámara en sintaxis vieja (un par
 * `015F set_camera_position` + `0160 set_camera_point_at` cada uno) en la
 * pareja de movimiento CLEO equivalente:
 *
 *   0936: set_camera x1 y1 z1 position_to x2 y2 z2 time T smooth_transition S
 *   0920: point_camera x1 y1 z1 transverse_to x2 y2 z2 time T smooth_transition S
 *
 * El primer grupo es el estado INICIAL (from), el segundo el FINAL (to).
 * Las coordenadas de cada línea se toman de los primeros 3 números del cuerpo
 * (X, Y, Z) y se preservan tal cual fueron escritas (decimales intactos).
 * El `time` / `smooth_transition` salen de la configuración `sb4.camera.*`.
 */
export class CameraMergeProvider extends Singleton {
	private baseProvider: BaseProvider = BaseProvider.getInstance();

	private t = (key: string, params?: Record<string, string | number>) =>
		LocaleManager.getInstance().t(key, params);

	public register() {
		this.baseProvider.context.subscriptions.push(
			vscode.commands.registerCommand('sb4.mergeCamera', () => this.merge())
		);
	}

	/** Extrae X, Y, Z de una línea de cámara clásica (primeros 3 números). */
	private parseLine(text: string): CameraLine | undefined {
		if (/^\s*(\/\/|;)/.test(text)) {
			return undefined;
		}
		const m = CAMERA_LINE_RE.exec(text);
		if (!m) {
			return undefined;
		}
		const body = text.slice(m[0].length);
		const nums = body.match(/-?\d+(?:\.\d+)?/g);
		if (!nums || nums.length < 3) {
			return undefined;
		}
		return {
			kind: m[1].toUpperCase() === '015F' ? 'pos' : 'point',
			x: nums[0],
			y: nums[1],
			z: nums[2],
		};
	}

	private async merge() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void showInfoToast(this.t('cm.noEditor'));
			return;
		}

		const doc = editor.document;
		if (doc.languageId !== 'sannybuilder') {
			void showInfoToast(this.t('cm.noEditor'));
			return;
		}

		const selection = editor.selection;
		if (selection.isEmpty) {
			void showInfoToast(this.t('cm.noSelection'));
			return;
		}

		const startLine = Math.min(selection.start.line, selection.end.line);
		const endLine = Math.max(selection.start.line, selection.end.line);

		const parsed: CameraLine[] = [];
		for (let l = startLine; l <= endLine; l++) {
			const line = this.parseLine(doc.lineAt(l).text);
			if (line) {
				parsed.push(line);
			}
		}

		const pos = parsed.filter(line => line.kind === 'pos');
		const point = parsed.filter(line => line.kind === 'point');

		// Se necesitan EXACTAMENTE dos pos y dos point (los comentarios/líneas
		// en blanco del medio se ignoran: parsed ya viene depurado).
		if (pos.length !== 2 || point.length !== 2) {
			void showInfoToast(this.t('cm.invalidSelection'));
			return;
		}

		const cfg = vscode.workspace.getConfiguration('sb4.camera');
		const time = cfg.get<number>('mergeTime', 45000);
		const smooth = cfg.get<boolean>('mergeSmooth', true) ? 1 : 0;

		const [pos1, pos2] = pos;
		const [pt1, pt2] = point;

		const indentMatch = /^(\s*)/.exec(doc.lineAt(startLine).text);
		const indent = indentMatch ? indentMatch[1] : '';

		const lines = [
			`${indent}0936: set_camera ${pos1.x} ${pos1.y} ${pos1.z} position_to ${pos2.x} ${pos2.y} ${pos2.z} time ${time} smooth_transition ${smooth}`,
			`${indent}0920: point_camera ${pt1.x} ${pt1.y} ${pt1.z} transverse_to ${pt2.x} ${pt2.y} ${pt2.z} time ${time} smooth_transition ${smooth}`,
		];

		const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
		const applied = await editor.edit(edit => edit.replace(range, lines.join('\n')));

		if (applied) {
			const p = new vscode.Position(startLine, 0);
			editor.selection = new vscode.Selection(p, p);
			editor.revealRange(new vscode.Range(p, p));
			void showInfoToast(this.t('cm.merged'));
		}
	}
}
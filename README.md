# Visual Builder 4 - A 3D GTA Coding Extension

### This is a fork of [sb4-vscode](https://github.com/NoPressF/sb4-vscode) by EOS(NoPressF)

<img width="1280" height="720" alt="logoPNG" src="https://github.com/user-attachments/assets/7fa8e4e5-7522-4d58-94c1-87fa8b196148" />

## Description

Visual Builder 4 is an extension that aims for bringing the functionalities of [Sanny Builder 4](https://sannybuilder.com/) into Visual Studio Code. It allows compilation, decompilation and launching the .exe from VS Code, with real-time syntax coloring, configurable themes and a fully translatable UI.

## Features

- **Compile / Decompile** — `F6` / `F7` with evidence-based success detection, diagnostics on your real file, rollback of the binary when a compile fails, and a virtual tab that shows the compiled output without touching the binary on disk.
- **Themes** — import SB4 `.ini` themes or build your own with the **Theme Creator** (with alive preview). Your themes live in the extension's own data folder, never in the Sanny Builder folder.
- **Search opcodes** — `Ctrl+Alt+2` webview with opcodes and class/member reference.
- **Sanny Builder Library** — `Ctrl+Alt+L` opens the library jumping to the section of your active GTA version.
- **Game integration** — `F8` launches the game (with Quick Loading that skips intro movies and restores them on exit). `sb4.insertCoordinates` / `sb4.insertAngle` insert the player's position.
- **Translations** — en/es built in by default, plus **import/export your own UI language** (`VB4: Import UI Texts` / `VB4: Export UI Texts`).
- **FXT support** — `.fxt` files open as Windows-1252 encoding, with FXT entry diagnostics, `Ctrl+Shift+Enter` next-entry, and auto-recovery of UTF-8 files that can be converted.
- **Autosave** — a lost editor tab is recovered from a virtual cache on the next startup.
- **Extras** — loop `wait` diagnostics, jump/include providers, smart settings webview, and `F9` builds the extension VSIX from the development host.
- **AND MORE!!! (I think...)**

## Requirements

- **Sanny Builder 4** installed on your system ([sannybuilder.com](https://sannybuilder.com/)).
- Visual Studio Code **^1.108.0**.

## Getting started

1. Install the `.vsix` (see [Releases](https://github.com/JustMixel/visual-builder4/releases)) or build it with `F9` from the Extension Development Host.
2. Run **`Select SB4 Folder`** (`Ctrl+Shift+P` → `Select SB4 Folder`) and point to your Sanny Builder 4 installation.
3. Run **`Select GTA Version`** to choose your game mode (e.g. `sa_sbl`).
4. Optional: **`Select Game Folder`** so `F8`, coordinate insertion and IMG-in-use warnings know where your game lives.

## Keyboard shortcuts

| Key | Command |
| --- | --- |
| `F6` | Compile |
| `F7` | Decompile |
| `F1` | Expand / cycle opcode (`{XXXX:}`) |
| `Tab` | Fill next opcode parameter |
| `F8` | Open game (Quick Loading) |
| `F9` | Build extension VSIX |
| `Ctrl+Alt+2` | Search opcodes |
| `Ctrl+Alt+Ctrl+...` — see below: | |
| `Ctrl+Alt+M` | Merge camera movement |
| `Ctrl+Alt+L` | Open Sanny Builder Library |
| `Ctrl+Shift+C` | Insert player coordinates |
| `Ctrl+Shift+E` | Insert player angle |
| `Ctrl+Shift+Enter` | Next FXT entry |

All commands are also available through the Command Palette (`Ctrl+Shift+P`, search `VB4:`).

## Settings

All settings live under the `sb4.*` namespace (`File ▸ Preferences ▸ Settings`), including:

- `sb4.language` — UI language (`en` default; other languages are imported copies).
- `sb4.colors.enabled` / `sb4.colors.iniPath` — syntax coloring + theme file (themes live in the extension's data folder).
- `sb4.toast.autoDismiss` / `sb4.toast.duration` — auto-hiding info toasts.
- `sb4.autosave.*` — recent-file autosave behavior.
- `sb4.camera.*` — camera merge time and smooth transition defaults.
- `sb4.coords.*` — coordinate/angle precision and process overrides.
- `sb4.openGame.quickLoad` — skip intro videos on `F8` (restored on exit).

## Development

Working on the extension itself:

1. Clone the repo and run `npm install`.
2. Press **`F5`** to open the **Extension Development Host** (a second VS Code window where the extension runs for testing). Reload it with **`Developer: Reload Window`** after each change.
3. Inside the dev host:
   - **`F9`** — runs `npm run compile:release` and packages the VSIX with `vsce`.
   - **`F8`** — quick-loads a game (from the editor before `F5`).
   - **`Ctrl+Alt+2`** — search opcodes inside the dev host.
   - **`Ctrl+Shift+P`** → **`Developer: Toggle Developer Tools`** and watch the Console tab for webview errors.
4. All output goes to the **`sb4-out`** output channel (`View ▸ Output ▸ VB4`).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run compile` | `tsc` + `tsc-alias` (development build to `dist/`) |
| `npm run compile:release` | `tsc -p tsconfig.release.json` + `tsc-alias` (release build) |
| `npm run watch` | `tsc -watch` (dev) |

### Test harnesses (standalone, no VS Code)

Logic that doesn't need the VS Code API is validated with node scripts that use a lightweight `vscode` stub plus the real SB4 data. The harnesses live in a **temp development folder** (they are never part of the repo or the VSIX), and each one is a single standalone `.cjs`:

```powershell
# stub VS Code (harness base) — lives in the temp dev folder, alongside the scripts:
$env:NODE_PATH = "C:\Users\<YOUR USER>\AppData\Local\Temp\opencode\vscode-stub\node_modules"
node sim-opcode-format.cjs   # SBL opcode format (17 PASS)
node sim-reserved-diag.cjs   # reserved words (7 PASS)
node sim-camera-merge.js     # camera merge (prints merged points + “valid: true”)
```

> Run them from wherever the harnesses are copied (they reference the real SB4
> data by relative path). They use a minimal `vscode` stub (no VS Code, no F5):
> useful to guard regressions in pure logic during development, and they run
> under Node directly from any folder that has the stub available.

### Packaging notes

- The extension ships **only the compiled `dist/`** in the VSIX: sources, `tsconfig.*`, `node_modules` and the SB4 folder are excluded via `.vscodeignore`.
- Themes, imported languages and caches live in the extension's own data folder (`globalStorage`), **never** in the Sanny Builder installation.
- The VSIX is built with `vsce package` (uses `vscode:prepublish` → `compile:release`); the `0.1.0` build produced a ~1.23 MB `visual-builder-4-0.1.0.vsix`.

## License

MIT — see [LICENSE](LICENSE). This is an **unofficial** fork, not affiliated with the Sanny Builder 4 developers.

## Acknowledgement

Based on [sb4-vs-code](https://github.com/JustMixel/sb4-vs-code) by EOS/NoPressF — thank you for the original work.

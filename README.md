# Visual Builder 4 - A 3D GTA Coding Extension

### This is a fork of [sb4-vscode](https://github.com/NoPressF/sb4-vscode) by EOS(NoPressF)

<img width="1920" height="1080" alt="logoPNG" src="https://github.com/user-attachments/assets/7fa8e4e5-7522-4d58-94c1-87fa8b196148" />

## Description

Visual Builder 4 turns Visual Studio Code into a full editor for [Sanny Builder 4](https://sannybuilder.com/) scripts (GTA SA/VC/III). It replaces the Sanny Builder editor: compile, decompile and launch the game from VS Code, with real-time syntax coloring, configurable themes and a fully translatable UI.

## Features

- **Compile / Decompile** — `F6` / `F7` with evidence-based success detection, diagnostics on your real file, rollback of the binary when a compile fails, and a virtual tab that shows the compiled output without touching the binary on disk.
- **SBL opcode format** `{00A5:}` — expand an opcode number with `F1`, cycle through the family on repeated `F1`, fill `[type]` placeholders with `Tab`, and get SBL-valid output (`int handle =`, `0@, 1@, 2@ =`) — never `[var ...]`.
- **Syntax coloring** — 18 categories rendered incrementally line-by-line (instant even on a 44k-line `main.scm`): conditional/switch/loop keywords, declared variables with types, classes/members, enums, negative numbers and more.
- **Themes** — import SB4 `.ini` themes or build your own with the **Theme Creator** (live preview). Your themes live in the extension's own data folder, never in the Sanny Builder folder.
- **Search opcodes** — `Ctrl+Alt+2` webview with opcodes and class/member reference.
- **Sanny Builder Library** — `Ctrl+Alt+L` opens the library jumping to the section of your active GTA version.
- **Game integration** — `F8` launches the game (with optional Quick Loading that skips intro movies and restores them on exit). `sb4.insertCoordinates` / `sb4.insertAngle` insert the player's position.
- **Translations** — en/es built in, plus **import/export your own UI language** (`VB4: Import UI Texts` / `VB4: Export UI Texts`).
- **FXT support** — `.fxt` files open as Windows-1252 (no corruption on save), with GXT entry diagnostics, `Ctrl+Shift+Enter` next-entry, and auto-recovery of UTF-8 files that can be converted.
- **Autosave** — a lost editor tab is recovered from a virtual cache on the next startup.
- **Camera merge** — `Ctrl+Alt+M` converts a pair of classic `015F`/`0160` camera groups into the CLEO equivalent `0936`/`0920`.
- **Extras** — loop `wait` diagnostics, jump/include providers, smart settings webview, and `F9` builds the extension VSIX from the development host.

## Requirements

- **Sanny Builder 4** installed on your system ([sannybuilder.com](https://sannybuilder.com/)).
- Visual Studio Code **^1.108.0**.

## Installation

1. Install the `.vsix` from the [Releases](https://github.com/JustMixel/visual-builder4/releases) page (`Code ▸ Extensions ▸ ⋯ ▸ Install from VSIX...`), or build it yourself with `F9` from the Extension Development Host.
2. **`VB4: Select SB4 Folder`** — point to your Sanny Builder 4 installation folder.
3. **`VB4: Select GTA Version`** — choose your game version/mode (e.g. `sa_sbl`).
4. Optional: **`VB4: Select Game Folder`** so `F8`, coordinates and IMG-in-use warnings know where your game lives.

## Usage

| Shortcut | Command |
| --- | --- |
| `F6` | Compile script |
| `F7` | Decompile script |
| `F1` | Expand / cycle opcode number |
| `Tab` | Fill next opcode parameter |
| `Ctrl+Alt+2` | Search opcodes |
| `Ctrl+Alt+M` | Merge camera movement |
| `Ctrl+Alt+L` | Open Sanny Builder Library |
| `Ctrl+Shift+C` / `Ctrl+Shift+E` | Insert player coordinates / angle |
| `Ctrl+Shift+Enter` | Next FXT entry |
| `F8` | Open game (quick load) |
| `F9` | Build extension VSIX |

Everything is also available through the Command Palette (`Ctrl+Shift+P`, search `VB4:`).

## Configuration

All settings live under the `sb4.*` namespace (`File ▸ Preferences ▸ Settings`), including:

- `sb4.language` — active UI language (`en` default).
- `sb4.colors.enabled` / `sb4.colors.iniPath` — syntax coloring and theme file.
- `sb4.toast.autoDismiss` / `sb4.toast.duration` — auto-hiding info toasts.
- `sb4.autosave.*` — editor autosave cache behavior.
- `sb4.camera.*` — camera merge defaults.
- `sb4.coords.*` — coordinate/angle precision and process overrides.
- `sb4.openGame.quickLoad` — skip intro videos on `F8`.

## Contributions

Issues, ideas and pull requests are welcome ✨

## License

This extension is distributed under the [MIT License](LICENSE).

**Note**: This extension is unofficial and is not affiliated with the developers of Sanny Builder 4.
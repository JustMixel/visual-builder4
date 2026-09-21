# Changelog

Todas las notas de las versiones de **Visual Builder 4** viven acá. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [0.1.0] — 2026-09-21

Primera versión pública probada contra Sanny Builder 4 (modo `sa_sbl`, GTA SA).

### Añadido

- **Compilar/Descompilar (F6/F7)** con detección de éxito por **evidencia** (no
  por la presencia del `compile.log`): espera las señales concluyentes del
  proceso y reporta errores reales con diagnóstico por línea sobre TU archivo.
- **Rollback del binario** en compilaciones fallidas: si sanny escribe un
  binario roto, se restaura la versión buena anterior desde un backup temporal.
- **Merge de cámara** (`Ctrl+Alt+M`): convierte dos grupos clásicos
  `015F`/`0160` (posición + point) en el equivalente CLEO `0936`/`0920`,
  tomando la duración y la suavidad de `sb4.camera.*`.
- **Sanny Builder Library** (`Ctrl+Alt+L`): abre la biblioteca
  (https://library.sannybuilder.com) en la sección del GTA activo, validando
  siempre el dominio confiable.
- **Inserción de coordenadas y ángulo** del jugador (`Ctrl+Shift+C`,
  `Ctrl+Shift+E`) dentro de métodos de clase (separadas por coma) o en estilo
  opcode clásico (separadas por espacio).
- **Búsqueda de opcodes** (`Ctrl+Alt+2`), **expandir opcode** (F1, expande y
  cicla por la familia), **rellenar parámetros con Tab** y **formato SBL
  canónico** (`{XXXX:}`, salida `int handle =`, sin `[var …]` jamás).
- **Coloreo sintáctico incremental** por línea, con 18 categorías de color,
  variables declaradas con tipo, números negativos, `and/or`, keywords de
  `if/switch/loop`, y 2 motores de tema (importar tema `.ini` de SB4 o
  crear el tuyo con preview en vivo).
- **UI traducible**: `en`/`es` incorporados + importar/exportar idiomas
  nuevos (`VB4: Import UI Texts` / `VB4: Export UI Texts`). Webview de
  ajustes con selector de idioma, tema y fuentes.
- **Soporte .fxt**: encoding Windows-1252 forzado (adiós mojibake), guardia
  de corrupción, diagnóstico de entradas largas y de espacio final,
  `Ctrl+Shift+Enter` para la entrada siguiente y **protección al compilar/
  descompilar** (los `.fxt` no son código: se avisa y se bloquea).
- **Autosave** de la pestaña reciente + restauración de pestañas virtuales
  entre sesiones (caché en disco).
- **Loop/while sin `wait`**: diagnóstico asíncrono por línea (no bloquea el
  coloreo) que avisa cuando un loop puede colgar el juego.
- **F8**: lanza el juego con Quick Loading (oculta los videos de intro y los
  restaura al salir). **F9**: empaqueta el VSIX de la extensión.
- Configuración `sb4.language`, `sb4.autosave.*`, `sb4.camera.*`,
  `sb4.coords.*`, `sb4.openGame.*` y más.

### Documentación

- `README.md` reescrito con las funciones reales de VB4.
- `CHANGELOG.md` con `[Keep a Changelog]`.

### Desarrolladores

- `npm run compile` → `tsc --release` + `tsc-alias`; build del VSIX con
  `vsce package` (`vscode:prepublish`).
- Nueva carpeta propia de datos (`getExtensionThemesDir`): los temas viven en
  el `globalStorage` de la extensión, no en la instalación de Sanny Builder.
- Harness de validación (`sim-*.cjs`, `sb4-cycle-test.js`) para probar la
  lógica sin VS Code.

## [0.0.1] — 2026-09-18

Lanzamiento inicial del fork (basado en sb4-vscode de NoPressF): F6 compila,
F7 descompila, F8 abre el juego, F1 expande opcodes, selección de carpeta SB4
y de versión GTA, coloreo básico y búsqueda de opcodes.

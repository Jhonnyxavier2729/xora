# Xora

Un lienzo infinito con zoom para trabajar con agentes de código. Cada carpeta de proyecto es un *workspace* donde colocas, mueves y redimensionas paneles:

- **Terminal**: shell real (PowerShell 7 si está instalado) mediante ConPTY.
- **Agente**: Claude Code, Codex, OpenCode, Cursor CLI, Gemini CLI o cualquier comando. El panel detecta si el agente **trabaja**, **te espera** o **pide aprobación**, y te avisa con una notificación.
- **Editor**: Monaco (el editor de VS Code) con árbol de archivos. Ctrl+S guarda.
- **Navegador**: para ver tu app en `localhost` o cualquier web.
- **Notas**: Markdown con vista previa.
- **Git**: cambios, diff, commit, **comentarios en el diff que se envían a un agente** y **tareas aisladas en worktrees** (un agente por rama).
- **Xen**: tu compañero de voz. Vive en el dock y te sigue con la mirada. Mantén pulsada una tecla (por defecto *Ctrl derecho*), habla y suelta: los bordes de la pantalla se iluminan mientras escucha, y Xen transcribe y reparte la petición al agente adecuado. También acepta texto, y *Dictar* escribe lo que dices donde está tu cursor.
- **Acceso remoto**: abre tus terminales y agentes desde el móvil, responde cuando un agente te espera y háblale a Xen. Se empareja con un código QR de un solo uso; opcionalmente, un túnel HTTPS de Cloudflare permite entrar fuera de casa.

## Requisitos

- Windows 10/11, Node.js 22 o superior.
- Los agentes que quieras usar, instalados y en el PATH (p. ej. `npm install -g @anthropic-ai/claude-code`).
- Para Xen: una clave de **Anthropic**. Para la voz: una clave de **Groq** (recomendada, rápida y con capa gratuita) u **OpenAI**. Se introducen en *Ajustes → Claves API* y se guardan cifradas con el almacén seguro de Windows.
- Para el túnel remoto (opcional): `winget install Cloudflare.cloudflared`.

## Uso

```bash
npm install
```

```bash
npm run dev
```

Para crear el instalador de Windows en `dist/`:

```bash
npm run dist
```

### La interfaz

Todo flota sobre el lienzo, a pantalla completa:

- **Arriba a la izquierda**: el espacio actual y su carpeta (clic en la ruta para abrirla en el Explorador).
- **Arriba a la derecha**: estado del acceso móvil, ajustes y bandeja de agentes.
- **Izquierda, Espacios**: tus carpetas de proyecto; el punto naranja indica que un agente te espera.
- **Derecha, Herramientas**: crea agentes, terminales, editor, navegador, notas o git.
- **Abajo**: *Añadir panel*, *Pregúntale a Xen* (toca para escribir), *Dictar* (escribe lo que dices en el panel enfocado), el botón de Xen para hablarle y la *Bandeja*.
- **Abajo a la derecha**: minimapa (clic o arrastre para moverte), lista de paneles y zoom.
- **Bajo el dock**: oscurecido del fondo (☀) y opacidad de los paneles (◐).
- **Abajo a la izquierda, Extras**: *Cambiar aspecto* (9 temas, 8 acentos y 50 fondos, o tu propia imagen), voz, claves y acceso móvil.
- **Clic derecho en el fondo**: menú con filtro para crear tareas, terminales, editor, navegador o notas en ese punto, la biblioteca de paneles, seleccionar todo, ordenar automáticamente, ajustar a la vista, pegar y cambiar aspecto.

### Controles del lienzo

| Acción | Cómo |
| --- | --- |
| Moverse | Arrastrar el fondo, botón central del ratón, mantener Espacio y arrastrar, o el minimapa |
| Zoom | Ctrl + rueda (alrededor del cursor), o los botones − / + |
| Ver todo | Botón ⛶ junto al zoom |
| Maximizar un panel | Doble clic en su cabecera |
| Renombrar un panel | Doble clic en su título |
| Ir a un panel | Lista de paneles (☰) o la Bandeja |
| Color de una nota | Puntos de color en la barra de la nota |
| Seleccionar todo y mover en grupo | Ctrl + A, y arrastrar cualquiera de los paneles |
| Ordenar automáticamente | Ctrl + Shift + L |
| Ajustar a la vista | Ctrl + Shift + 1 |
| Biblioteca de paneles | Ctrl + Shift + E |
| Pegar una URL (navegador) o texto (nota) | Ctrl + V sobre el lienzo |

## Arquitectura

```
src/
  main/        proceso principal de Electron
    pty.ts       terminales (node-pty) y detección de estado de los agentes
    xen.ts       Xen: Claude con herramientas para listar, leer, crear y escribir en paneles
    voice.ts     píldora de voz, tecla de mantener pulsado (uiohook) y transcripción (Groq/OpenAI)
    remote.ts    servidor HTTP + WebSocket del acceso remoto, emparejamiento y túnel
    git.ts       estado, diff, commit y worktrees (simple-git)
    files.ts     acceso a archivos limitado a los workspaces abiertos
    store.ts     persistencia (userData/state.json) y secretos cifrados (safeStorage)
  preload/     API mínima expuesta con contextBridge
  renderer/    React: lienzo, paneles, ajustes, píldora de voz y cliente remoto (móvil)
  shared/      tipos compartidos
```

Seguridad: ventanas con `contextIsolation`, `sandbox` y sin `nodeIntegration`; los `<webview>` no reciben preload; el acceso a archivos se limita a los workspaces abiertos; el acceso remoto exige un token por dispositivo (guardado como hash) y se puede revocar.

## Limitaciones conocidas

- La detección de "trabajando / te espera" es heurística: se basa en la actividad de salida de la terminal y en patrones de aprobación (y/n, *Allow*…).
- Con un zoom distinto del 100 %, la selección con el ratón en terminales puede desplazarse ligeramente.
- En la red local, el acceso remoto va por HTTP sin cifrar y el navegador del móvil no permite el micrófono; usa el túnel HTTPS para la voz desde el móvil.

## Créditos

- Logotipo e iconos: propios de Xora (`build/icon.svg`; `node build/make-icons.mjs` regenera el PNG y el ICO).
- Fondos: obras de la colección de Birmingham Museums Trust, dominio público (CC0). Ver `src/renderer/public/wallpapers/CREDITS.md`.

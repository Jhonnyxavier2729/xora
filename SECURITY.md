# Security

Xora runs coding agents, terminals and a small remote-access server on your machine, so it is built to keep that power contained. This document describes what is protected and how.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability). You will get an answer as soon as possible.

## Electron hardening

- Every window runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The renderer only sees a small API exposed through `contextBridge`.
- Production builds ship a strict Content-Security-Policy (`script-src 'self'`).
- `<webview>` guests (the browser panel) get no preload and no Node, cannot open new windows, cannot navigate to `file:` or `javascript:` URLs, and cannot embed other webviews.
- `window.open` is denied everywhere; `http(s)` links open in the system browser.
- Permission requests (microphone, notifications) are granted only to Xora's own pages, never to websites in the browser panel.
- Packaged builds disable the `RunAsNode`, `NODE_OPTIONS` and `--inspect` Electron fuses and only load the app from its ASAR archive.

## File system and processes

- File reads and writes from the UI are limited to open workspaces and their worktrees. Paths are resolved through symlinks/junctions, so a link inside a project cannot reach outside it.
- "Open folder" only opens directories inside a workspace or Xora's data folder — never files (opening an `.exe` would run it).
- Git operations pass file names after `--` so they can never be parsed as options; only worktrees created by Xora can be removed.
- Agents in "New task" can only run inside an open workspace.
- Clone URLs are restricted to `https://`, `git@` and `ssh://` (no `ext::` or other transports).

## Secrets

- API keys are encrypted with the OS secure storage (Windows DPAPI via Electron `safeStorage`) and are never sent to the renderer — only whether each key is set.
- Keys are only passed to an agent (as environment variables) if you explicitly choose "Use key" for that agent.
- Any error text shown in the app or sent to a paired device goes through a redaction step that hides bearer tokens, known key formats (`sk-…`, `gsk_…`, `ghp_…`, …), token-like JSON fields and `*_API_KEY=…` assignments.

## Remote access

Remote access is **off by default**. When enabled:

- Devices pair with an 8-character one-time code that expires after 10 minutes. Pairing is rate-limited per IP, and the code is invalidated after 20 failed attempts in total (all tunnel traffic arrives from `127.0.0.1`).
- Each device gets a random 256-bit token. Only its SHA-256 hash is stored, comparisons are constant-time, and devices can be revoked at any time.
- The WebSocket token travels in the `Sec-WebSocket-Protocol` header, never in the URL, so it does not end up in proxy or tunnel logs.
- Responses carry `nosniff`, `X-Frame-Options: DENY`, `no-referrer` and same-origin policies; malformed requests are rejected without affecting the app.
- **A paired device has the same power as you at the keyboard**: it can type into your terminals and agents. Pair only devices you own and revoke the ones you no longer use.
- On the local network the traffic is plain HTTP. Use the HTTPS tunnel when you are not on a network you trust.

## Known limitations

- Agent "working / waiting" detection is heuristic and is not a security boundary.
- With "Full access" (or agent autonomy flags) an agent can edit files and run commands without asking. Use it in Git repositories where changes can be reviewed and reverted.
- `npm audit` reports a moderate issue in `sprintf-js`, used only by `electron-builder` at build time. It is not shipped with the app and no fixed version exists yet.

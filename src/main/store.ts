import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SECRET_NAMES, type SecretName, type SecretStatus, type Settings, type Workspace } from '@shared/types'

interface PersistedDevice {
  id: string
  name: string
  tokenHash: string
  createdAt: number
  lastSeenAt: number
}

interface RecentEntry {
  path: string
  name: string
  openedAt: number
}

interface StateFile {
  workspaces: Workspace[]
  recents: RecentEntry[]
  settings: Settings
  devices: PersistedDevice[]
  /** Secretos cifrados con safeStorage (base64). */
  secrets: Partial<Record<SecretName, string>>
}

const dataDir = (): string => {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const statePath = (): string => join(dataDir(), 'state.json')

let state: StateFile | null = null
let saveTimer: NodeJS.Timeout | null = null

function load(): StateFile {
  if (state) return state
  let parsed: Partial<StateFile> = {}
  try {
    if (existsSync(statePath())) parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch (err) {
    console.error('[store] estado corrupto, se empieza de cero', err)
  }
  state = {
    workspaces: parsed.workspaces ?? [],
    recents: parsed.recents ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    devices: parsed.devices ?? [],
    secrets: parsed.secrets ?? {}
  }
  return state
}

function writeNow(): void {
  if (!state) return
  const tmp = statePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, statePath())
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeNow()
  }, 300)
}

export function flushStore(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeNow()
}

export const store = {
  getWorkspaces(): Workspace[] {
    return load().workspaces
  },
  getWorkspace(id: string): Workspace | undefined {
    return load().workspaces.find((w) => w.id === id)
  },
  saveWorkspaces(workspaces: Workspace[]): void {
    const s = load()
    s.workspaces = workspaces
    // Toda carpeta abierta queda en «Proyectos recientes», aunque luego se quite de la lista.
    for (const w of workspaces) {
      if (!s.recents.some((r) => r.path.toLowerCase() === w.root.toLowerCase())) {
        s.recents.unshift({ path: w.root, name: w.name, openedAt: Date.now() })
      }
    }
    s.recents = s.recents.slice(0, 30)
    scheduleSave()
  },
  getRecents(): RecentEntry[] {
    return load().recents
  },
  touchRecent(path: string): void {
    const s = load()
    const entry = s.recents.find((r) => r.path.toLowerCase() === path.toLowerCase())
    if (entry) entry.openedAt = Date.now()
    s.recents.sort((a, b) => b.openedAt - a.openedAt)
    scheduleSave()
  },
  forgetRecent(path: string): void {
    const s = load()
    s.recents = s.recents.filter((r) => r.path.toLowerCase() !== path.toLowerCase())
    scheduleSave()
  },
  getSettings(): Settings {
    return load().settings
  },
  setSettings(patch: Partial<Settings>): Settings {
    const s = load()
    s.settings = { ...s.settings, ...patch }
    scheduleSave()
    return s.settings
  },
  getDevices(): PersistedDevice[] {
    return load().devices
  },
  setDevices(devices: PersistedDevice[]): void {
    load().devices = devices
    scheduleSave()
  },
  notesDir(workspaceId: string): string {
    const dir = join(dataDir(), 'notes', workspaceId.replace(/[^a-zA-Z0-9_-]/g, ''))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }
}

export type { PersistedDevice }

export const secrets = {
  get(name: SecretName): string | null {
    const enc = load().secrets[name]
    if (!enc) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  },
  set(name: SecretName, value: string | null): void {
    const s = load()
    if (!value) delete s.secrets[name]
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado del sistema no está disponible')
      s.secrets[name] = safeStorage.encryptString(value.trim()).toString('base64')
    }
    scheduleSave()
  },
  status(): SecretStatus {
    const s = load().secrets
    return Object.fromEntries(SECRET_NAMES.map((n) => [n, !!s[n]])) as SecretStatus
  }
}

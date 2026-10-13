import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { CanvasCommand, Panel, PanelType } from '@shared/types'

let mainWindow: BrowserWindow | null = null
const pending = new Map<string, { resolve: (panelId: string) => void; reject: (err: Error) => void }>()

export function setCanvasWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getCanvasWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function send(cmd: CanvasCommand): void {
  const win = getCanvasWindow()
  if (!win) throw new Error('La ventana principal no está abierta')
  win.webContents.send('canvas:command', cmd)
}

/** Pide al renderer que cree un panel; resuelve con el id del panel creado. */
export function createPanel(workspaceId: string, panel: Partial<Panel> & { type: PanelType }): Promise<string> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('El lienzo no respondió a tiempo'))
    }, 8000)
    pending.set(requestId, {
      resolve: (id) => {
        clearTimeout(timer)
        resolve(id)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      }
    })
    try {
      send({ kind: 'create-panel', requestId, workspaceId, panel })
    } catch (err) {
      pending.delete(requestId)
      clearTimeout(timer)
      reject(err as Error)
    }
  })
}

export function focusPanel(workspaceId: string, panelId: string): void {
  send({ kind: 'focus-panel', workspaceId, panelId })
  const win = getCanvasWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
  }
}

const confirms = new Map<string, (ok: boolean) => void>()

/** Pide al usuario que apruebe acciones de Xen. Sin respuesta en 60 s, se consideran rechazadas. */
export function confirmActions(items: string[]): Promise<boolean> {
  const win = getCanvasWindow()
  if (!win) return Promise.resolve(false)
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      confirms.delete(requestId)
      resolve(false)
    }, 60_000)
    confirms.set(requestId, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    win.webContents.send('xen:confirm', requestId, items)
  })
}

export function resolveConfirm(requestId: string, ok: boolean): void {
  confirms.get(requestId)?.(ok)
  confirms.delete(requestId)
}

export function resolveCanvasRequest(requestId: string, panelId: string | null, error?: string): void {
  const p = pending.get(requestId)
  if (!p) return
  pending.delete(requestId)
  if (panelId) p.resolve(panelId)
  else p.reject(new Error(error || 'No se pudo crear el panel'))
}

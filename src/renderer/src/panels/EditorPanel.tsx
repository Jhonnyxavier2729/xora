import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, Panel } from '@shared/types'
import { IconFile, IconFolder } from '../components/Icons'
import { useApp } from '../state'
import { errMsg } from '../utils'
import './monacoSetup'

function TreeNode({ entry, depth, selected, onOpen }: { entry: FileEntry; depth: number; selected?: string; onOpen: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)

  async function toggle() {
    if (!entry.dir) return onOpen(entry.path)
    if (!open && !children) {
      try {
        setChildren(await window.api.fs.list(entry.path))
      } catch (err) {
        useApp.getState().toast(errMsg(err), 'error')
      }
    }
    setOpen(!open)
  }

  return (
    <>
      <button
        className={`tree-row ${selected === entry.path ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => void toggle()}
        title={entry.path}
      >
        <span className="tree-caret">{entry.dir ? (open ? '▾' : '▸') : ''}</span>
        {entry.dir ? <IconFolder size={13} /> : <IconFile size={13} />}
        <span className="tree-name">{entry.name}</span>
      </button>
      {open && children?.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} selected={selected} onOpen={onOpen} />)}
    </>
  )
}

export function EditorPanel({ wsId, panel }: { wsId: string; panel: Panel }) {
  const root = panel.cwd ?? ''
  const editorFontSize = useApp((s) => s.settings?.editorFontSize ?? 13)
  const editorMinimap = useApp((s) => s.settings?.editorMinimap ?? false)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [content, setContent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valueRef = useRef('')
  const fileRef = useRef(panel.file)

  const refreshTree = useCallback(() => {
    window.api.fs.list(root).then(setEntries, (err) => setError(errMsg(err)))
  }, [root])

  useEffect(refreshTree, [refreshTree])

  const open = useCallback(
    async (path: string) => {
      if (dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return
      try {
        const text = await window.api.fs.read(path)
        valueRef.current = text
        fileRef.current = path
        setContent(text)
        setDirty(false)
        setError(null)
        const name = path.split(/[\\/]/).pop()
        useApp.getState().updatePanel(wsId, panel.id, { file: path, title: `Editor · ${name}` })
      } catch (err) {
        setError(errMsg(err))
      }
    },
    [dirty, wsId, panel.id]
  )

  useEffect(() => {
    if (panel.file) void open(panel.file)
    // Solo al montar: reabre el último archivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async () => {
    if (!fileRef.current) return
    try {
      await window.api.fs.write(fileRef.current, valueRef.current)
      setDirty(false)
    } catch (err) {
      useApp.getState().toast(errMsg(err), 'error')
    }
  }, [])

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
  }

  return (
    <div className="editor-panel">
      <div className="file-tree">
        <div className="tree-head">
          <span title={root}>{root.split(/[\\/]/).pop()}</span>
          <button className="icon-btn small" title="Recargar" onClick={refreshTree}>
            ↻
          </button>
        </div>
        <div className="tree-scroll">
          {entries.map((e) => (
            <TreeNode key={e.path} entry={e} depth={0} selected={panel.file} onOpen={(p) => void open(p)} />
          ))}
        </div>
      </div>
      <div className="editor-main">
        {panel.file && (
          <div className="editor-tabbar">
            <span className="editor-file" title={panel.file}>
              {panel.file.replace(root, '').replace(/^[\\/]/, '')}
              {dirty && <span className="dirty">●</span>}
            </span>
            <button className="btn small" disabled={!dirty} onClick={() => void save()}>
              Guardar
            </button>
          </div>
        )}
        {error && <div className="panel-error">{error}</div>}
        {content !== null && panel.file ? (
          <Editor
            key={panel.file}
            path={panel.file}
            defaultValue={content}
            theme="xora"
            onMount={onMount}
            onChange={(v) => {
              valueRef.current = v ?? ''
              if (!dirty) setDirty(true)
            }}
            options={{
              fontSize: editorFontSize,
              fontFamily: '"Cascadia Code", Consolas, monospace',
              minimap: { enabled: editorMinimap },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              tabSize: 2
            }}
          />
        ) : (
          <div className="empty center">Elige un archivo del árbol.</div>
        )}
      </div>
    </div>
  )
}

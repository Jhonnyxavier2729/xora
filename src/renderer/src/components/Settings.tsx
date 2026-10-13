import { useEffect, useMemo, useState } from 'react'
import {
  AGENTS,
  AUTONOMY_FLAGS,
  OPENAI_TTS_VOICES,
  SECRET_NAMES,
  type AccountStatus,
  type TaskModels,
  type TaskProvider,
  type AgentId,
  type AgentVersionInfo,
  type AppInfo,
  type NoteColor,
  type RemoteState,
  type SecretName,
  type SecretStatus,
  type Settings,
  type XenProviderConfig,
  type XenProviderId,
  type XenProviderStatus
} from '@shared/types'
import { useApp } from '../state'
import { errMsg, timeAgo } from '../utils'
import { speak, systemVoices } from '../speech'
import { LookContent } from './Chrome'
import {
  IconAgent,
  IconBell,
  IconBrowser,
  IconClose,
  IconEditor,
  IconGit,
  IconNotes,
  IconPhone,
  IconSettings,
  IconTerminal
} from './Icons'
import { XenFace } from './XenFace'
import { ProviderIcon } from '../panels/TaskPanel'

// ---------------------------------------------------------------------------
// Piezas comunes

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

function Row({ title, desc, children }: { title: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="s-row">
      <div className="s-row-text">
        <strong>{title}</strong>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="s-row-control">{children}</div>}
    </div>
  )
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="s-group">
      <h3>{title}</h3>
      {desc && <p className="s-group-desc">{desc}</p>}
      <div className="s-card">{children}</div>
    </section>
  )
}

function useSettings(): [Settings | null, (p: Partial<Settings>) => Promise<void>] {
  const settings = useApp((s) => s.settings)
  return [settings, useApp.getState().updateSettings]
}

// ---------------------------------------------------------------------------
// Xen

/** Proveedores de Xen. Los CLIs toman su lista de modelos del propio agente (la misma que «Nueva tarea»). */
const PROVIDER_INFO: Record<XenProviderId, { name: string; agent: TaskProvider | null; models: [string, string][] }> = {
  'claude-cli': { name: 'Claude Code', agent: 'claude', models: [['opus', 'Opus']] },
  'codex-cli': { name: 'Codex', agent: 'codex', models: [['', 'Modelo predeterminado']] },
  'opencode-cli': { name: 'OpenCode', agent: 'opencode', models: [['', 'Modelo predeterminado']] },
  api: {
    name: 'API de Anthropic',
    agent: null,
    models: [
      ['claude-opus-5-5', 'Claude Opus 5.5'],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
      ['claude-haiku-5-5', 'Claude Haiku 5.5']
    ]
  }
}

function ProviderBadge({ id }: { id: XenProviderId }) {
  const agent = PROVIDER_INFO[id].agent
  return <span className="provider-icon">{agent ? <ProviderIcon id={agent} size={18} /> : '⚡'}</span>
}

const IS_MAC = window.api.app.platform === 'darwin'

const HOLD_KEYS = [
  ...(IS_MAC ? [] : [['CtrlRight', 'Ctrl derecho']]),
  ['AltRight', IS_MAC ? 'Opción derecha' : 'Alt derecho / AltGr'],
  ['ShiftRight', 'Shift derecho'],
  ['MetaRight', IS_MAC ? 'Comando derecho' : 'Windows derecho'],
  ['F8', 'F8'],
  ['F9', 'F9'],
  ['F10', 'F10'],
  ['ScrollLock', 'Bloq Despl'],
  ['Pause', 'Pausa']
] as const

const SAMPLE_PHRASE = 'Hola, soy Xen. Abro una terminal nueva y le paso la tarea a Claude Code.'

/** Voz de Xen: motor (sistema u OpenAI), voz concreta, velocidad y prueba. */
function VoiceOfXen() {
  const [settings, update] = useSettings()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [hasOpenAi, setHasOpenAi] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void systemVoices().then(setVoices)
    void window.api.secrets.status().then((s) => setHasOpenAi(!!s.openai))
  }, [])
  if (!settings) return null
  const lang = (settings.language || 'es').toLowerCase()
  // Primero las voces en tu idioma.
  const sorted = [...voices].sort((a, b) => Number(b.lang.toLowerCase().startsWith(lang)) - Number(a.lang.toLowerCase().startsWith(lang)))

  async function test() {
    if (!settings) return
    setTesting(true)
    setError(null)
    setError(await speak(SAMPLE_PHRASE, settings))
    setTesting(false)
  }

  return (
    <Group title="Voz de Xen">
      <Row
        title="Motor de voz"
        desc={
          settings.ttsProvider === 'openai'
            ? hasOpenAi
              ? 'Voz natural de OpenAI. Cuesta céntimos al mes con un uso normal.'
              : 'Necesita tu clave de OpenAI en «Claves API». Sin ella, Xen usa la voz del sistema.'
            : 'La voz del sistema es gratis pero suena robótica.'
        }
      >
        <select value={settings.ttsProvider} onChange={(e) => void update({ ttsProvider: e.target.value as Settings['ttsProvider'] })}>
          <option value="openai">Natural · OpenAI</option>
          <option value="system">Sistema · gratis</option>
        </select>
      </Row>
      <Row title="Voz">
        {settings.ttsProvider === 'openai' ? (
          <select value={settings.ttsVoice} onChange={(e) => void update({ ttsVoice: e.target.value })}>
            {OPENAI_TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        ) : (
          <select value={settings.systemVoice} onChange={(e) => void update({ systemVoice: e.target.value })}>
            <option value="">Automática</option>
            {sorted.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.replace(/^Microsoft /, '').replace(/ - .*$/, '')} · {v.lang}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Row title="Velocidad" desc={`${settings.speechRate.toFixed(2).replace(/0$/, '')}×`}>
        <input
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={settings.speechRate}
          onChange={(e) => void update({ speechRate: Number(e.target.value) })}
        />
      </Row>
      <Row title="Probar la voz" desc={error ?? 'Escucha cómo suena con estos ajustes.'}>
        <button className="btn" disabled={testing} onClick={() => void test()}>
          {testing ? 'Cargando…' : '▶ Escuchar'}
        </button>
      </Row>
    </Group>
  )
}

function XenSection() {
  const [settings, update] = useSettings()
  const [statuses, setStatuses] = useState<XenProviderStatus[]>([])
  const [models, setModels] = useState<TaskModels | null>(null)
  useEffect(() => {
    void window.api.xen.providers().then(setStatuses)
    void window.api.task.models().then(setModels)
  }, [])
  if (!settings) return null
  const providers = settings.xenProviders
  const modelOptions = (id: XenProviderId, current: string): [string, string][] => {
    const agent = PROVIDER_INFO[id].agent
    const list: [string, string][] = agent && models ? models[agent].map((m) => [m.id, m.label]) : PROVIDER_INFO[id].models
    // Conserva el valor guardado aunque ya no esté en la lista (p. ej. el alias «opus»).
    return list.some(([v]) => v === current) ? list : [[current, current || 'Modelo predeterminado'], ...list]
  }
  const setProviders = (list: XenProviderConfig[]) => void update({ xenProviders: list })
  const move = (i: number, d: number) => {
    const list = [...providers]
    const [item] = list.splice(i, 1)
    list.splice(i + d, 0, item)
    setProviders(list)
  }
  const missing = (Object.keys(PROVIDER_INFO) as XenProviderId[]).filter((id) => !providers.some((p) => p.id === id))

  return (
    <>
      <div className="s-hero">
        <XenFace size={56} />
        <div>
          <h2>Xen</h2>
          <p className="muted">El compañero que te responde, y qué puede hacer por ti.</p>
        </div>
      </div>

      <Group title="Quién responde" desc="Xen usa el primero disponible, en este orden. Si uno falla o no está instalado, prueba con el siguiente.">
        {providers.map((p, i) => {
          const st = statuses.find((s) => s.id === p.id)
          const info = PROVIDER_INFO[p.id]
          return (
            <div key={p.id} className="provider-row">
              <div className="provider-order">
                <button className="icon-btn small" disabled={i === 0} onClick={() => move(i, -1)} title="Subir prioridad">
                  ▲
                </button>
                <span className="order-num">{i + 1}</span>
                <button className="icon-btn small" disabled={i === providers.length - 1} onClick={() => move(i, 1)} title="Bajar prioridad">
                  ▼
                </button>
              </div>
              <ProviderBadge id={p.id} />
              <div className="grow">
                <div className="provider-name">
                  <strong>{info.name}</strong>
                  <span className={`provider-state ${st?.ready ? 'ready' : ''}`}>● {st ? (st.ready ? 'listo' : 'no disponible') : '…'}</span>
                </div>
                <div className="muted small">{st?.detail}</div>
              </div>
              <label className="provider-model">
                Modelo
                <select value={p.model} onChange={(e) => setProviders(providers.map((x) => (x.id === p.id ? { ...x, model: e.target.value } : x)))}>
                  {modelOptions(p.id, p.model).map(([v, label]) => (
                    <option key={v || 'default'} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="icon-btn small" title="Quitar" onClick={() => setProviders(providers.filter((x) => x.id !== p.id))}>
                <IconClose size={13} />
              </button>
            </div>
          )
        })}
        {missing.length > 0 && (
          <div className="provider-add">
            {missing.map((id) => (
              <button
                key={id}
                className="btn small"
                onClick={() => setProviders([...providers, { id, model: PROVIDER_INFO[id].models[0][0] }])}
              >
                + Añadir {PROVIDER_INFO[id].name} como alternativa
              </button>
            ))}
          </div>
        )}
        <details className="s-details">
          <summary>Cómo funcionan las alternativas</summary>
          <p>
            Con Claude Code, Codex u OpenCode, Xen usa tu propia cuenta del agente: no necesitas una clave de API. Xen le pasa el estado
            del lienzo y lo que dijiste, y el agente devuelve un plan que Xora ejecuta (enviar un mensaje a un agente, crear un
            panel…). Con la API de Anthropic, Xen usa herramientas directamente y necesita una clave en «Claves API».
          </p>
        </details>
      </Group>

      <Group title="Acciones">
        <Row
          title="Actuar sin preguntar"
          desc="Xen envía mensajes a tus agentes y crea paneles en cuanto se lo pides. Desactívalo para confirmar cada acción antes."
        >
          <Toggle on={settings.xenActWithoutAsking} onChange={(v) => void update({ xenActWithoutAsking: v })} />
        </Row>
        <Row title="Reiniciar la conversación" desc="Xen olvida lo hablado (también se reinicia sola tras 10 minutos sin uso).">
          <button className="btn small" onClick={() => void window.api.xen.reset().then(() => useApp.getState().toast('Conversación reiniciada'))}>
            Reiniciar
          </button>
        </Row>
      </Group>

      <Group title="Voz">
        <Row title="Mantén pulsada para hablar" desc="Funciona aunque Xora no esté en primer plano: mantén la tecla, habla y suelta.">
          <select value={settings.holdKey} onChange={(e) => void update({ holdKey: e.target.value })}>
            {HOLD_KEYS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Atajo para empezar o parar">
          <input
            defaultValue={settings.toggleShortcut}
            placeholder="CommandOrControl+Shift+Space"
            onBlur={(e) => e.target.value !== settings.toggleShortcut && void update({ toggleShortcut: e.target.value.trim() })}
          />
        </Row>
        <Row title="Transcripción" desc="Convierte tu voz en texto con Whisper. Necesita la clave del proveedor en «Claves API».">
          <select value={settings.sttProvider} onChange={(e) => void update({ sttProvider: e.target.value as Settings['sttProvider'] })}>
            <option value="groq">Groq · whisper-large-v3-turbo</option>
            <option value="openai">OpenAI · gpt-4o-mini-transcribe</option>
          </select>
          <select value={settings.language} onChange={(e) => void update({ language: e.target.value })}>
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
            <option value="">Detectar</option>
          </select>
        </Row>
        <Row title="Leer en voz alta las respuestas">
          <Toggle on={settings.speakReplies} onChange={(v) => void update({ speakReplies: v })} />
        </Row>
      </Group>

      <VoiceOfXen />
    </>
  )
}

// ---------------------------------------------------------------------------
// Agentes

const ACCOUNT_INFO: Record<TaskProvider, { name: string; key: string; keyName: SecretName | null }> = {
  claude: { name: 'Claude Code', key: 'Clave de Anthropic', keyName: 'anthropic' },
  codex: { name: 'Codex', key: 'Clave de OpenAI', keyName: 'openai' },
  opencode: { name: 'OpenCode', key: 'Todas tus claves guardadas', keyName: null }
}

/** Cuentas de cada agente: sesión propia (como en su CLI) o tu clave de API. */
function AccountsGroup({ onLogin }: { onLogin: (command: string) => void }) {
  const [settings, update] = useSettings()
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null)
  const [keys, setKeys] = useState<SecretStatus | null>(null)
  const load = () => {
    void window.api.accounts.status().then(setAccounts)
    void window.api.secrets.status().then(setKeys)
  }
  useEffect(load, [settings?.agentUseApiKey])
  if (!settings) return null

  return (
    <Group
      title="Cuentas"
      desc="Cada agente usa la sesión que iniciaste en su CLI. Si prefieres, puede usar tu clave de API (se guarda cifrada en Claves API)."
    >
      {(accounts ?? []).map((acc) => {
        const info = ACCOUNT_INFO[acc.id]
        const useKey = !!settings.agentUseApiKey[acc.id]
        const hasKey = info.keyName ? !!keys?.[info.keyName] : true
        return (
          <div key={acc.id} className="s-row account-row">
            <span className="provider-icon">
              <ProviderIcon id={acc.id} size={18} />
            </span>
            <div className="s-row-text">
              <strong>{info.name}</strong>
              <p>
                {useKey ? (
                  hasKey ? (
                    <>Usa tu {info.key.toLowerCase()}.</>
                  ) : (
                    <span className="warn-text">Falta la {info.key.toLowerCase()}: añádela en Claves API.</span>
                  )
                ) : acc.signedIn ? (
                  <>
                    <span className="provider-state ready">● sesión iniciada</span> {acc.label}
                  </>
                ) : (
                  <span className="provider-state">● sin sesión</span>
                )}
              </p>
            </div>
            <div className="s-row-control">
              <label className="check small" title="Usar tu clave de API en lugar de la sesión">
                <input type="checkbox" checked={useKey} onChange={(e) => void update({ agentUseApiKey: { ...settings.agentUseApiKey, [acc.id]: e.target.checked } })} />
                Usar clave
              </label>
              {!useKey && (
                <button
                  className="btn small"
                  onClick={async () => onLogin(await window.api.accounts.loginCommand(acc.id))}
                >
                  {acc.signedIn ? 'Cambiar cuenta' : 'Iniciar sesión'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {accounts === null && <div className="s-row muted">Comprobando sesiones…</div>}
      <div className="s-row">
        <button className="btn small" onClick={load}>
          Volver a comprobar
        </button>
        <span className="muted small">Al iniciar sesión se abre una terminal con el comando del agente; sigue sus pasos y vuelve a comprobar.</span>
      </div>
    </Group>
  )
}

function AgentsSection() {
  const [settings, update] = useSettings()
  const [versions, setVersions] = useState<AgentVersionInfo[] | null>(null)
  const load = () => {
    setVersions(null)
    void window.api.agents.versions().then(setVersions)
  }
  useEffect(load, [])
  if (!settings) return null

  function runUpdate(command: string) {
    const app = useApp.getState()
    const wsId = app.activeId ?? app.workspaces[0]?.id
    if (!wsId) {
      void navigator.clipboard.writeText(command)
      return app.toast('Comando copiado: ábrelo en una terminal')
    }
    const id = app.addPanel(wsId, { type: 'terminal', title: command })
    app.setSettingsOpen(false)
    app.openWorkspace(wsId)
    // La terminal se crea al montarse el panel; se espera un momento antes de escribir.
    setTimeout(() => void window.api.pty.submit(id, command), 1500)
  }

  return (
    <>
      <h2>Agentes</h2>
      <p className="muted">Claude Code, Codex y OpenCode: sus cuentas, cuánta autonomía tienen y sus versiones.</p>

      <AccountsGroup onLogin={runUpdate} />

      <Group
        title="Autonomía"
        desc="Qué puede hacer cada agente sin detenerse a preguntarte. Se aplica al abrir un panel de agente nuevo."
      >
        {AGENTS.filter((a) => AUTONOMY_FLAGS[a.id]).map((a) => (
          <Row
            key={a.id}
            title={a.name}
            desc={
              <>
                Los paneles lanzan <code>{`${a.command} ${AUTONOMY_FLAGS[a.id]}`}</code>: el agente actúa sin pedir confirmación.
              </>
            }
          >
            <Toggle
              on={!!settings.agentAutonomy[a.id]}
              onChange={(v) => void update({ agentAutonomy: { ...settings.agentAutonomy, [a.id]: v } })}
            />
          </Row>
        ))}
        <Row
          title="OpenCode"
          desc={
            <>
              OpenCode usa los permisos de su propia configuración (<code>opencode.json</code>); por defecto puede editar y ejecutar
              comandos sin preguntar.
            </>
          }
        />
        <p className="s-warn">⚠ Con la autonomía activada el agente puede editar archivos y ejecutar comandos sin preguntar. Úsala en proyectos con git, donde puedes revisar y deshacer cambios.</p>
      </Group>

      <Group title="Versiones" desc="Compara cada CLI instalado con su última versión publicada.">
        <Row title="Avisar de actualizaciones">
          <Toggle on={settings.checkAgentUpdates} onChange={(v) => void update({ checkAgentUpdates: v })} />
        </Row>
        {versions === null && <div className="s-row muted">Comprobando versiones…</div>}
        {versions?.map((v) => {
          const agent = AGENTS.find((a) => a.id === v.id)!
          const outdated = !!(v.installed && v.latest && v.installed !== v.latest)
          return (
            <Row
              key={v.id}
              title={agent.name}
              desc={
                v.installed ? (
                  <>
                    Instalada <code>{v.installed}</code>
                    {v.latest && (
                      <>
                        {' '}
                        · última <code>{v.latest}</code>
                      </>
                    )}
                    {outdated && settings.checkAgentUpdates && <span className="pill-tag waiting">hay una versión nueva</span>}
                  </>
                ) : (
                  <>
                    No instalado · <code>{agent.installHint}</code>
                  </>
                )
              }
            >
              {v.updateCommand && (outdated || !v.installed) && (
                <button className="btn small" onClick={() => runUpdate(v.updateCommand!)}>
                  {v.installed ? 'Actualizar' : 'Instalar'}
                </button>
              )}
            </Row>
          )
        })}
        <div className="s-row">
          <button className="btn small" onClick={load}>
            Volver a comprobar
          </button>
        </div>
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Acceso remoto

function RemoteSection() {
  const [state, setState] = useState<RemoteState | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useApp.getState().toast

  useEffect(() => {
    void window.api.remote.state().then(setState)
    return window.api.remote.onChanged(setState)
  }, [])

  async function run(fn: () => Promise<RemoteState>) {
    setBusy(true)
    try {
      setState(await fn())
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  return (
    <>
      <h2>Acceso remoto</h2>
      <p className="muted">Abre tus terminales y agentes desde el móvil u otro ordenador, responde cuando un agente te espera y háblale a Xen.</p>
      <Group title="Este ordenador">
        <Row title="Permitir acceso remoto" desc="Cada dispositivo se empareja una vez con un código de un solo uso.">
          <Toggle on={state.enabled} disabled={busy} onChange={(v) => void run(v ? window.api.remote.enable : window.api.remote.disable)} />
        </Row>
        {state.enabled && (
          <div className="remote-pair">
            {state.pairQr ? (
              <>
                <img src={state.pairQr} alt="Código QR para emparejar" />
                <div>
                  <p>
                    Escanea el QR con el móvil o abre <code>{state.pairUrl}</code>
                  </p>
                  <p>
                    Código: <strong className="pair-code">{state.pairCode}</strong>{' '}
                    {state.pairExpiresAt && (
                      <span className="muted">(caduca en {Math.max(0, Math.round((state.pairExpiresAt - Date.now()) / 60000))} min)</span>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <p className="muted">El último código ya se usó.</p>
            )}
            <button className="btn small" onClick={() => void run(window.api.remote.newPairCode)}>
              Nuevo código
            </button>
          </div>
        )}
      </Group>

      {state.enabled && (
        <Group title="Conexión">
          <Row
            title="Red local"
            desc={
              <>
                {state.lanUrls.map((u) => (
                  <code key={u} className="block">
                    {u}
                  </code>
                ))}
                En la red local el tráfico va sin cifrar y el móvil no permite usar el micrófono. Para usarlo fuera de casa o con voz,
                activa el túnel HTTPS.
              </>
            }
          >
            <span className="muted">{state.connectedClients} conectado(s)</span>
          </Row>
          <Row
            title="Túnel HTTPS (Cloudflare)"
            desc={
              <>
                {state.tunnelStatus === 'starting' && 'Iniciando túnel… '}
                {state.tunnelUrl && <code className="block">{state.tunnelUrl}</code>}
                {state.tunnelStatus === 'missing' && (
                  <>
                    Necesitas <code>cloudflared</code>: <code>winget install Cloudflare.cloudflared</code>.{' '}
                  </>
                )}
                Crea una URL pública temporal cifrada. Solo entran dispositivos emparejados.
              </>
            }
          >
            <Toggle
              on={state.tunnelStatus === 'on' || state.tunnelStatus === 'starting'}
              disabled={busy}
              onChange={(v) => void run(() => window.api.remote.tunnel(v))}
            />
          </Row>
        </Group>
      )}

      <Group title="Dispositivos emparejados">
        {state.devices.length === 0 && <div className="s-row muted">Ninguno todavía.</div>}
        {state.devices.map((d) => (
          <Row key={d.id} title={d.name} desc={`Visto ${timeAgo(d.lastSeenAt)}`}>
            <button className="btn small danger" onClick={() => void run(() => window.api.remote.revoke(d.id))}>
              Revocar
            </button>
          </Row>
        ))}
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Claves

const KEY_INFO: Record<SecretName, { label: string; hint: string; url: string }> = {
  anthropic: {
    label: 'Anthropic',
    hint: 'Para Xen con «API de Anthropic» y para Claude Code u OpenCode si eliges usar tu clave en lugar de la sesión.',
    url: 'https://console.anthropic.com/settings/keys'
  },
  openai: {
    label: 'OpenAI',
    hint: 'Transcripción de voz, y Codex u OpenCode si eliges usar tu clave en lugar de la sesión.',
    url: 'https://platform.openai.com/api-keys'
  },
  groq: { label: 'Groq', hint: 'Transcripción de voz con Whisper: rápida y con capa gratuita.', url: 'https://console.groq.com/keys' },
  gemini: { label: 'Google Gemini', hint: 'Modelos de Google en OpenCode.', url: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter', hint: 'Cientos de modelos en OpenCode con una sola clave.', url: 'https://openrouter.ai/keys' }
}

function KeyRow({ name, set, onSaved }: { name: SecretName; set: boolean; onSaved: (s: SecretStatus) => void }) {
  const [value, setValue] = useState('')
  const info = KEY_INFO[name]
  return (
    <div className="s-row s-row-col">
      <div className="s-row-text">
        <strong>
          {info.label} <span className={`pill-tag ${set ? 'working' : ''}`}>{set ? 'guardada' : 'sin configurar'}</span>
        </strong>
        <p>
          {info.hint}{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), void window.api.shell.openExternal(info.url))}>
            Obtener clave
          </a>
        </p>
      </div>
      <div className="row">
        <input type="password" value={value} placeholder={set ? '•••••••• (escribe para reemplazar)' : 'Pega la clave'} onChange={(e) => setValue(e.target.value)} />
        <button
          className="btn small primary"
          disabled={!value.trim()}
          onClick={async () => {
            onSaved(await window.api.secrets.set(name, value.trim()))
            setValue('')
          }}
        >
          Guardar
        </button>
        {set && (
          <button className="btn small" onClick={async () => onSaved(await window.api.secrets.set(name, null))}>
            Quitar
          </button>
        )}
      </div>
    </div>
  )
}

function KeysSection() {
  const [status, setStatus] = useState<SecretStatus | null>(null)
  useEffect(() => {
    void window.api.secrets.status().then(setStatus)
  }, [])
  if (!status) return null
  return (
    <>
      <h2>Claves API</h2>
      <p className="muted">Se guardan cifradas con el almacén seguro de Windows y solo se envían a su proveedor.</p>
      <Group title="Claves">
        {SECRET_NAMES.map((n) => (
          <KeyRow key={n} name={n} set={status[n]} onSaved={setStatus} />
        ))}
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Resto de secciones

function AppearanceSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Apariencia</h2>
      <p className="muted">Tema, color de acento y fondo del lienzo.</p>
      <div className="s-look">
        <LookContent />
      </div>
      <Group title="Ajustes finos">
        <Row title="Oscurecer el fondo" desc={`${settings.wallpaperDim} %`}>
          <input type="range" min={0} max={90} value={settings.wallpaperDim} onChange={(e) => void update({ wallpaperDim: Number(e.target.value) })} />
        </Row>
        <Row title="Opacidad de los paneles" desc={`${settings.panelOpacity} %`}>
          <input type="range" min={70} max={100} value={settings.panelOpacity} onChange={(e) => void update({ panelOpacity: Number(e.target.value) })} />
        </Row>
      </Group>
    </>
  )
}

const SHORTCUTS: [string, string[]][] = [
  ['Hablar con Xen (mantener)', ['Ctrl derecho']],
  ['Empezar o parar la grabación', ['Ctrl', 'Shift', 'Espacio']],
  ['Ir al espacio 1…9', ['Ctrl', '1…9']],
  ['Biblioteca de paneles', ['Ctrl', 'Shift', 'E']],
  ['Seleccionar todos los paneles', ['Ctrl', 'A']],
  ['Ordenar automáticamente', ['Ctrl', 'Shift', 'L']],
  ['Ajustar a la vista', ['Ctrl', 'Shift', '1']],
  ['Pegar URL o texto en el lienzo', ['Ctrl', 'V']],
  ['Zoom', ['Ctrl', 'Rueda']],
  ['Moverse por el lienzo', ['Espacio', 'Arrastrar']],
  ['Guardar en el editor', ['Ctrl', 'S']],
  ['Cancelar o deseleccionar', ['Esc']]
]

function ShortcutsSection() {
  return (
    <>
      <h2>Atajos de teclado</h2>
      <Group title="Atajos">
        {SHORTCUTS.map(([label, keys]) => (
          <Row key={label} title={label}>
            <span className="kbds">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </Row>
        ))}
      </Group>
      <p className="muted small">La tecla de voz y el atajo de grabación se cambian en Ajustes → Xen.</p>
    </>
  )
}

function NotificationsSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Notificaciones</h2>
      <Group title="Agentes">
        <Row title="Avisarme cuando un agente termine o me espere" desc="Notificación de Windows si Xora no está en primer plano, y aviso en la app y en el móvil.">
          <Toggle on={settings.notifyOnWaiting} onChange={(v) => void update({ notifyOnWaiting: v })} />
        </Row>
      </Group>
    </>
  )
}

function CanvasSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Lienzo</h2>
      <Group title="Navegación">
        <Row title="Mostrar minimapa" desc="Abajo a la derecha; haz clic o arrastra para moverte.">
          <Toggle on={settings.showMinimap} onChange={(v) => void update({ showMinimap: v })} />
        </Row>
      </Group>
    </>
  )
}

function PanelsSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Paneles y diseño</h2>
      <Group title="Paneles">
        <Row title="Opacidad de los paneles" desc={`${settings.panelOpacity} %`}>
          <input type="range" min={70} max={100} value={settings.panelOpacity} onChange={(e) => void update({ panelOpacity: Number(e.target.value) })} />
        </Row>
        <Row title="Ordenar automáticamente" desc="Coloca todos los paneles en una rejilla ordenada (Ctrl+Shift+L o clic derecho en el lienzo)." />
      </Group>
    </>
  )
}

function TerminalSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Terminal</h2>
      <Group title="Terminal">
        <Row title="Shell" desc="Vacío = PowerShell 7 si está instalado, si no Windows PowerShell.">
          <input defaultValue={settings.shell} placeholder="C:\Program Files\Git\bin\bash.exe" onBlur={(e) => void update({ shell: e.target.value.trim() })} />
        </Row>
        <Row title="Tamaño de letra" desc="Se aplica a las terminales nuevas.">
          <input type="number" min={9} max={24} defaultValue={settings.terminalFontSize} onBlur={(e) => void update({ terminalFontSize: Math.min(24, Math.max(9, Number(e.target.value) || 13)) })} />
        </Row>
      </Group>
    </>
  )
}

function EditorSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Editor</h2>
      <Group title="Editor de código">
        <Row title="Tamaño de letra">
          <input type="number" min={9} max={24} defaultValue={settings.editorFontSize} onBlur={(e) => void update({ editorFontSize: Math.min(24, Math.max(9, Number(e.target.value) || 13)) })} />
        </Row>
        <Row title="Minimapa del código">
          <Toggle on={settings.editorMinimap} onChange={(v) => void update({ editorMinimap: v })} />
        </Row>
      </Group>
    </>
  )
}

function BrowserSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>Navegador</h2>
      <Group title="Navegador">
        <Row title="Página inicial" desc="Lo que abre un panel de navegador nuevo, p. ej. localhost:3000. Vacío = página en blanco.">
          <input defaultValue={settings.browserHome} placeholder="localhost:3000" onBlur={(e) => void update({ browserHome: e.target.value.trim() })} />
        </Row>
      </Group>
    </>
  )
}

const NOTE_COLORS: [NoteColor, string][] = [
  ['yellow', 'Amarillo'],
  ['green', 'Verde'],
  ['pink', 'Rosa'],
  ['blue', 'Azul'],
  ['dark', 'Oscuro']
]

function NotesSection() {
  const [settings, update] = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])
  if (!settings) return null
  return (
    <>
      <h2>Notas</h2>
      <Group title="Notas">
        <Row title="Color de las notas nuevas">
          <select value={settings.defaultNoteColor} onChange={(e) => void update({ defaultNoteColor: e.target.value as NoteColor })}>
            {NOTE_COLORS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Dónde se guardan" desc={info ? <code>{info.userData}\notes</code> : '…'} />
      </Group>
    </>
  )
}

function GitSection() {
  const [settings, update] = useSettings()
  const [dir, setDir] = useState('')
  useEffect(() => {
    void window.api.workspaces.defaultCloneDir().then(setDir)
  }, [settings?.cloneDir])
  if (!settings) return null
  return (
    <>
      <h2>Git y worktrees</h2>
      <Group title="Git">
        <Row title="Actualizar el estado cada" desc="Segundos entre comprobaciones del panel de Git.">
          <input type="number" min={2} max={120} defaultValue={settings.gitRefreshSeconds} onBlur={(e) => void update({ gitRefreshSeconds: Math.min(120, Math.max(2, Number(e.target.value) || 5)) })} />
        </Row>
        <Row title="Carpeta para clonar" desc={<code>{dir}</code>}>
          <button
            className="btn small"
            onClick={async () => {
              const d = await window.api.workspaces.pickCloneDir()
              if (d) void update({ cloneDir: d })
            }}
          >
            Cambiar
          </button>
        </Row>
        <Row
          title="Worktrees"
          desc="Cada tarea aislada se crea en una carpeta hermana del repositorio: <repo>-worktrees/<rama>. Así no ensucia tu proyecto."
        />
      </Group>
    </>
  )
}

function GeneralSection() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <>
      <h2>General</h2>
      <Group title="Red">
        <Row title="Puerto del acceso remoto" desc="Se aplica la próxima vez que actives el acceso remoto.">
          <input
            type="number"
            defaultValue={settings.remotePort}
            onBlur={(e) => {
              const port = Number(e.target.value)
              if (port >= 1024 && port <= 65535) void update({ remotePort: port })
            }}
          />
        </Row>
      </Group>
    </>
  )
}

function HelpSection() {
  return (
    <>
      <h2>Ayuda</h2>
      <Group title="Primeros pasos">
        <Row title="1. Crea un espacio" desc="Clic en «+» en Espacios: abre una carpeta, clona de GitHub o empieza un lienzo en blanco." />
        <Row title="2. Añade un agente" desc="Clic derecho en el lienzo → Nueva tarea, o la barra de Herramientas. Elige Claude Code, Codex u OpenCode y su modelo." />
        <Row title="3. Habla con Xen" desc="Mantén Ctrl derecho y di, por ejemplo, «dile a Claude que añada tests al login». Xen elige el agente y se lo envía." />
        <Row title="4. Revisa los cambios" desc="El panel de Git muestra el diff; haz clic en una línea para comentarla y enviársela al agente." />
        <Row title="5. Síguelo desde el móvil" desc="Ajustes → Acceso remoto: escanea el QR y responde a tus agentes desde cualquier sitio." />
      </Group>
    </>
  )
}

function PrivacySection() {
  return (
    <>
      <h2>Privacidad</h2>
      <Group title="Qué sale de tu ordenador">
        <Row title="Todo es local por defecto" desc="Tus archivos, espacios, notas e historial se quedan en este equipo. Xora no tiene servidores propios ni analítica." />
        <Row title="Xen" desc="Con Claude Code o Codex, el estado del lienzo y lo que dices se envía a ese agente, como cualquier otra petición suya. Con la API, a Anthropic." />
        <Row title="Voz" desc="El audio de cada orden se envía a Groq u OpenAI solo para transcribirlo." />
        <Row title="Acceso remoto" desc="Solo cuando lo activas. Con el túnel, el tráfico pasa cifrado por Cloudflare." />
        <Row title="Claves" desc="Cifradas con el almacén seguro de Windows; solo se envían a su proveedor." />
      </Group>
    </>
  )
}

function DiagnosticsSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [statuses, setStatuses] = useState<XenProviderStatus[]>([])
  const [agents, setAgents] = useState<Record<AgentId, boolean> | null>(null)
  useEffect(() => {
    void window.api.app.info().then(setInfo)
    void window.api.xen.providers().then(setStatuses)
    void window.api.agents.detect(true).then(setAgents)
  }, [])
  return (
    <>
      <h2>Diagnóstico</h2>
      <Group title="Xora">
        <Row title="Versión" desc={info ? `${info.version} · Electron ${info.electron} · Node ${info.node} · ${info.platform}` : '…'} />
        <Row title="Datos" desc={info ? <code>{info.userData}</code> : '…'}>
          {info && (
            <button className="btn small" onClick={() => void window.api.shell.openPath(info.userData)}>
              Abrir carpeta
            </button>
          )}
        </Row>
      </Group>
      <Group title="Xen">
        {statuses.map((s) => (
          <Row key={s.id} title={PROVIDER_INFO[s.id].name} desc={s.detail}>
            <span className={`provider-state ${s.ready ? 'ready' : ''}`}>● {s.ready ? 'listo' : 'no disponible'}</span>
          </Row>
        ))}
      </Group>
      <Group title="Agentes en el PATH">
        {AGENTS.map((a) => (
          <Row key={a.id} title={a.name} desc={<code>{a.command}</code>}>
            <span className={`provider-state ${agents?.[a.id] ? 'ready' : ''}`}>● {agents ? (agents[a.id] ? 'encontrado' : 'no encontrado') : '…'}</span>
          </Row>
        ))}
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Ventana de ajustes

interface Section {
  id: string
  label: string
  icon: JSX.Element
  group?: string
  keywords: string
  render: () => JSX.Element
}

const SECTIONS: Section[] = [
  { id: 'xen', label: 'Xen', icon: <XenFace size={16} />, keywords: 'asistente voz modelo claude codex api alternativas actuar preguntar tecla transcripción idioma', render: () => <XenSection /> },
  { id: 'agents', label: 'Agentes', icon: <IconAgent size={15} />, keywords: 'autonomía permisos versiones actualizar cuentas sesión claude codex opencode', render: () => <AgentsSection /> },
  { id: 'remote', label: 'Acceso remoto', icon: <IconPhone size={15} />, keywords: 'móvil qr túnel cloudflare dispositivos emparejar', render: () => <RemoteSection /> },
  { id: 'appearance', label: 'Apariencia', icon: <span>🎨</span>, keywords: 'tema acento fondo color imagen opacidad oscurecer', render: () => <AppearanceSection /> },
  { id: 'shortcuts', label: 'Atajos de teclado', icon: <span>⌨</span>, keywords: 'teclas atajos ctrl', render: () => <ShortcutsSection /> },
  { id: 'notifications', label: 'Notificaciones', icon: <IconBell size={15} />, keywords: 'avisos notificar', render: () => <NotificationsSection /> },
  { id: 'keys', label: 'Claves API', icon: <span>🔑</span>, keywords: 'anthropic groq openai clave api', render: () => <KeysSection /> },
  { id: 'canvas', label: 'Lienzo', group: 'Lienzo y paneles', icon: <span>▦</span>, keywords: 'minimapa zoom navegación', render: () => <CanvasSection /> },
  { id: 'panels', label: 'Paneles y diseño', group: 'Lienzo y paneles', icon: <span>▢</span>, keywords: 'opacidad ordenar rejilla', render: () => <PanelsSection /> },
  { id: 'terminal', label: 'Terminal', group: 'Herramientas', icon: <IconTerminal size={15} />, keywords: 'shell powershell bash letra', render: () => <TerminalSection /> },
  { id: 'editor', label: 'Editor', group: 'Herramientas', icon: <IconEditor size={15} />, keywords: 'monaco letra minimapa código', render: () => <EditorSection /> },
  { id: 'browser', label: 'Navegador', group: 'Herramientas', icon: <IconBrowser size={15} />, keywords: 'página inicial localhost web', render: () => <BrowserSection /> },
  { id: 'notes', label: 'Notas', group: 'Herramientas', icon: <IconNotes size={15} />, keywords: 'pósit color markdown', render: () => <NotesSection /> },
  { id: 'git', label: 'Git y worktrees', group: 'Herramientas', icon: <IconGit size={15} />, keywords: 'clonar rama worktree commit', render: () => <GitSection /> },
  { id: 'general', label: 'General', group: 'Xora', icon: <IconSettings size={15} />, keywords: 'puerto red', render: () => <GeneralSection /> },
  { id: 'help', label: 'Ayuda', group: 'Xora', icon: <span>?</span>, keywords: 'ayuda empezar guía', render: () => <HelpSection /> },
  { id: 'privacy', label: 'Privacidad', group: 'Xora', icon: <span>🔒</span>, keywords: 'privacidad datos local', render: () => <PrivacySection /> },
  { id: 'diagnostics', label: 'Diagnóstico', group: 'Xora', icon: <span>🩺</span>, keywords: 'versión diagnóstico datos path', render: () => <DiagnosticsSection /> }
]

export function SettingsModal() {
  const initial = useApp((s) => s.settingsTab)
  const [active, setActive] = useState(() => (SECTIONS.some((s) => s.id === initial) ? initial : 'xen'))
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const close = () => useApp.getState().setSettingsOpen(false)

  useEffect(() => {
    void window.api.app.info().then(setInfo)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS
  }, [query])

  useEffect(() => {
    if (visible.length && !visible.some((s) => s.id === active)) setActive(visible[0].id)
  }, [visible, active])

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]
  let lastGroup: string | undefined = '__start'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings">
        <div className="settings-head">
          <div>
            <strong>Ajustes</strong>
            <span className="muted">Haz Xora tuya</span>
          </div>
          <button className="icon-btn" onClick={close} title="Cerrar (Esc)">
            <IconClose />
          </button>
        </div>
        <div className="settings-body">
          <aside className="settings-nav">
            <input autoFocus className="settings-search" placeholder="Buscar en ajustes" value={query} onChange={(e) => setQuery(e.target.value)} />
            <nav>
              {visible.map((s) => {
                const header = s.group !== lastGroup && s.group ? <div className="nav-group">{s.group}</div> : null
                const spacer = s.group !== lastGroup && !s.group && lastGroup !== '__start' ? <div className="nav-space" /> : null
                lastGroup = s.group
                return (
                  <div key={s.id}>
                    {header}
                    {spacer}
                    <button className={`nav-item ${s.id === active ? 'on' : ''}`} onClick={() => setActive(s.id)}>
                      <span className="nav-icon">{s.icon}</span>
                      {s.label}
                    </button>
                  </div>
                )
              })}
              {visible.length === 0 && <div className="muted small nav-empty">Nada coincide con «{query}».</div>}
            </nav>
            <div className="settings-user">
              <span className="avatar" />
              <div>
                <strong>{info?.user ?? '…'}</strong>
                <span className="muted small">Uso local · gratis</span>
              </div>
            </div>
          </aside>
          <main className="settings-main" key={section.id}>
            {section.render()}
          </main>
        </div>
      </div>
    </div>
  )
}

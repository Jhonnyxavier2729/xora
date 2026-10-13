import type { PanelType } from '@shared/types'

type P = { size?: number }

const svg = (path: JSX.Element, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

export const IconTerminal = ({ size }: P) => svg(<><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></>, size)
export const IconAgent = ({ size }: P) =>
  svg(<><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4" /><circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" /></>, size)
export const IconEditor = ({ size }: P) => svg(<><path d="M8 6l-6 6 6 6" /><path d="M16 6l6 6-6 6" /></>, size)
export const IconBrowser = ({ size }: P) =>
  svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></>, size)
export const IconNotes = ({ size }: P) =>
  svg(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h5" /></>, size)
export const IconGit = ({ size }: P) =>
  svg(<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 8v8" /><path d="M18 11c0 4-6 3-11 6" /></>, size)
export const IconMic = ({ size }: P) =>
  svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>, size)
export const IconClose = ({ size }: P) => svg(<><path d="M6 6l12 12M18 6L6 18" /></>, size)
export const IconMax = ({ size }: P) => svg(<><rect x="5" y="5" width="14" height="14" rx="2" /></>, size)
export const IconRestore = ({ size }: P) => svg(<><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>, size)
export const IconHome = ({ size }: P) => svg(<><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>, size)
export const IconSettings = ({ size }: P) =>
  svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, size)
export const IconPlus = ({ size }: P) => svg(<><path d="M12 5v14M5 12h14" /></>, size)
export const IconFit = ({ size }: P) => svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>, size)
export const IconFolder = ({ size }: P) => svg(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>, size)
export const IconFile = ({ size }: P) => svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>, size)
export const IconBack = ({ size }: P) => svg(<><path d="M15 6l-6 6 6 6" /></>, size)
export const IconForward = ({ size }: P) => svg(<><path d="M9 6l6 6-6 6" /></>, size)
export const IconReload = ({ size }: P) => svg(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>, size)
export const IconSend = ({ size }: P) => svg(<><path d="M4 12l16-8-6 16-2-7z" /></>, size)
export const IconBell = ({ size }: P) => svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, size)
export const IconList = ({ size }: P) => svg(<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>, size)
export const IconPhone =({ size }: P) => svg(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>, size)

export const IconTask = ({ size }: P) =>
  svg(<><path d="M5 4h14v12H9l-4 4z" /><path d="M9 9h6M9 12h4" /></>, size)

export function PanelIcon({ type, size }: { type: PanelType; size?: number }) {
  switch (type) {
    case 'task':
      return <IconTask size={size} />
    case 'terminal':
      return <IconTerminal size={size} />
    case 'agent':
      return <IconAgent size={size} />
    case 'editor':
      return <IconEditor size={size} />
    case 'browser':
      return <IconBrowser size={size} />
    case 'notes':
      return <IconNotes size={size} />
    case 'git':
      return <IconGit size={size} />
  }
}

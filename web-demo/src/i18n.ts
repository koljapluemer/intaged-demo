import { createI18n } from 'vue-i18n'

const en = {
  app: {
    tagline: 'Collaborative documents with generated widgets.',
    newDocument: 'New document',
    openLink: 'Open link',
    openSharedLink: 'Open shared link',
    noRecent: 'No recent documents',
    pasteLink: 'Paste a theadoc link or document ID',
    adminRejected: 'Admin token was rejected.',
    untitled: 'Untitled',
    startWriting: 'Start writing.',
    language: 'Language',
  },
  document: {
    edit: 'Edit',
    read: 'Read',
    editDocument: 'Edit document',
    readDocument: 'Read document',
    share: 'Share',
    copyLink: 'Share document',
    export: 'Export',
    exportBundle: 'Export portable bundle',
  },
  share: {
    title: 'Share document',
    edit: 'Can edit',
    editHint: 'Anyone with the link can edit the document.',
    spec: 'Read-only with spec',
    specHint: 'Rendered view, with the description of each interactive element.',
    reader: 'Read-only',
    readerHint: 'Rendered view only, without sidebar or descriptions.',
    link: 'Link',
    copy: 'Copy link',
    copied: 'Copied',
    creating: 'Creating link…',
    close: 'Close',
  },
  shared: {
    readOnly: 'Read-only',
    notFound: 'This shared link is invalid or no longer available.',
    spec: 'Description',
  },
  editor: {
    heading: 'Heading',
    bold: 'Bold',
    italic: 'Italic',
    bulletList: 'Bullet list',
    list: 'List',
    insertWidget: 'Insert interactive element',
    widget: 'Interactive Element',
    widgetPlaceholder: 'Describe the interactive element.',
  },
  widget: {
    modes: { spec: 'Spec', rendered: 'Rendered', split: 'Split' },
    generate: 'Generate',
    generateNewVersion: 'Generate new version',
    regenerateFromScratch: 'Regenerate from scratch',
    regenerateHint: 'Discard the current code and generate from the spec alone',
    outOfDate: 'Out of date with the spec',
    renderFailed: 'Render failed: {error}',
    notRendered: 'Not rendered yet',
    notGenerated: 'Not generated yet',
    loading: 'Loading widget…',
    unavailable: 'Widget unavailable',
    tryAgain: 'Try again',
    frameTitle: 'Generated widget',
    stillFails: 'The widget still fails after automatic repair: {error}',
    serverRestarted: 'The server restarted during generation. Please try again.',
    connectionLost: 'Lost connection to the server. Check your connection and try again.',
  },
  stage: {
    waiting: 'Waiting to start',
    choosingTools: 'Choosing tools',
    readingUp: 'Reading up',
    planning: 'Planning',
    reviewing: 'Reviewing',
    drawing: 'Drawing',
    refining: 'Refining',
    preparingMap: 'Preparing map',
    working: 'Working',
    rendering: 'Rendering',
    restarting: 'Restarting',
    reconnecting: 'Reconnecting',
  },
}

type MessageSchema = typeof en

const de: MessageSchema = {
  app: {
    tagline: 'Gemeinsame Dokumente mit generierten Widgets.',
    newDocument: 'Neues Dokument',
    openLink: 'Link öffnen',
    openSharedLink: 'Geteilten Link öffnen',
    noRecent: 'Keine zuletzt geöffneten Dokumente',
    pasteLink: 'theadoc-Link oder Dokument-ID einfügen',
    adminRejected: 'Das Admin-Token wurde abgelehnt.',
    untitled: 'Unbenannt',
    startWriting: 'Einfach losschreiben.',
    language: 'Sprache',
  },
  document: {
    edit: 'Bearbeiten',
    read: 'Lesen',
    editDocument: 'Dokument bearbeiten',
    readDocument: 'Dokument lesen',
    share: 'Teilen',
    copyLink: 'Dokument teilen',
    export: 'Exportieren',
    exportBundle: 'Portables Paket exportieren',
  },
  share: {
    title: 'Dokument teilen',
    edit: 'Darf bearbeiten',
    editHint: 'Alle mit dem Link können das Dokument bearbeiten.',
    spec: 'Nur lesen, mit Beschreibung',
    specHint: 'Gerenderte Ansicht mit der Beschreibung jedes interaktiven Elements.',
    reader: 'Nur lesen',
    readerHint: 'Nur die gerenderte Ansicht, ohne Seitenleiste und Beschreibungen.',
    link: 'Link',
    copy: 'Link kopieren',
    copied: 'Kopiert',
    creating: 'Link wird erstellt…',
    close: 'Schließen',
  },
  shared: {
    readOnly: 'Nur lesen',
    notFound: 'Dieser geteilte Link ist ungültig oder nicht mehr verfügbar.',
    spec: 'Beschreibung',
  },
  editor: {
    heading: 'Überschrift',
    bold: 'Fett',
    italic: 'Kursiv',
    bulletList: 'Aufzählung',
    list: 'Liste',
    insertWidget: 'Interaktives Element einfügen',
    widget: 'Interaktives Element',
    widgetPlaceholder: 'Beschreibe das interaktive Element.',
  },
  widget: {
    modes: { spec: 'Beschreibung', rendered: 'Ansicht', split: 'Beides' },
    generate: 'Generieren',
    generateNewVersion: 'Neue Version generieren',
    regenerateFromScratch: 'Von Grund auf neu generieren',
    regenerateHint: 'Aktuellen Code verwerfen und nur aus der Beschreibung generieren',
    outOfDate: 'Passt nicht mehr zur Beschreibung',
    renderFailed: 'Generierung fehlgeschlagen: {error}',
    notRendered: 'Noch nicht generiert',
    notGenerated: 'Noch nicht generiert',
    loading: 'Widget wird geladen…',
    unavailable: 'Widget nicht verfügbar',
    tryAgain: 'Erneut versuchen',
    frameTitle: 'Generiertes Widget',
    stillFails: 'Das Widget schlägt auch nach automatischer Reparatur fehl: {error}',
    serverRestarted: 'Der Server wurde während der Generierung neu gestartet. Bitte erneut versuchen.',
    connectionLost: 'Verbindung zum Server verloren. Bitte Verbindung prüfen und erneut versuchen.',
  },
  stage: {
    waiting: 'Warte auf Start',
    choosingTools: 'Werkzeuge auswählen',
    readingUp: 'Einlesen',
    planning: 'Planen',
    reviewing: 'Prüfen',
    drawing: 'Zeichnen',
    refining: 'Verfeinern',
    preparingMap: 'Karte vorbereiten',
    working: 'Arbeiten',
    rendering: 'Rendern',
    restarting: 'Neustart',
    reconnecting: 'Verbinde neu',
  },
}

export const LOCALES = ['en', 'de'] as const
export type Locale = (typeof LOCALES)[number]

const STORAGE_KEY = 'theadoc:locale'
const URL_PARAM = 'lang'

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale)

/** A `?lang=` from a shared link wins, then the stored choice, then the browser language. */
function initialLocale(): Locale {
  // Tests import this module outside a browser.
  if (typeof location === 'undefined') return 'en'
  const fromUrl = new URLSearchParams(location.search).get(URL_PARAM)
  if (isLocale(fromUrl)) return fromUrl
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage is unavailable; fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, de },
})

export const t = i18n.global.t

export function currentLocale(): Locale {
  return i18n.global.locale.value
}

/** Adds `?lang=` to a URL unless the current locale is English, the default. */
export function withLocale(target: string | URL): string {
  const url = new URL(target, location.origin)
  if (currentLocale() === 'en') url.searchParams.delete(URL_PARAM)
  else url.searchParams.set(URL_PARAM, currentLocale())
  return url.pathname + url.search + url.hash
}

/** A link to `target` (the current page by default) that opens in the current language. */
export function shareUrl(target: string = location.href): string {
  return new URL(withLocale(target), location.origin).href
}

/** Keeps the address bar and `<html lang>` in line with the current locale. */
export function syncLocale() {
  document.documentElement.lang = currentLocale()
  const next = withLocale(location.href)
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next)
}

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // The choice still applies to this page and its URL.
  }
  syncLocale()
}

// Progress stages arrive from the server and the poller as English text.
const STAGES: Record<string, keyof MessageSchema['stage']> = {
  'Waiting to start': 'waiting',
  'Choosing tools': 'choosingTools',
  'Reading up': 'readingUp',
  Planning: 'planning',
  Reviewing: 'reviewing',
  Drawing: 'drawing',
  Refining: 'refining',
  'Preparing map': 'preparingMap',
  Working: 'working',
  Restarting: 'restarting',
  Reconnecting: 'reconnecting',
}

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return `${t('stage.rendering')}…`
  const key = STAGES[stage]
  return `${key ? t(`stage.${key}`) : stage}…`
}

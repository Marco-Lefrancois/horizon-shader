import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'
import { LOOKS } from './library.js'

// Bande de consommation au-dessus de l'invite, aux couleurs du look actif, pour suivre sa
// consommation d'un coup d'œil. Pour chaque fenêtre (semaine, 5 h) : une barre, le pourcentage, la
// réinitialisation en clair et le rythme, c'est-à-dire l'écart entre la part utilisée et la part
// du temps écoulée, avec la projection à la réinitialisation.

export const limitsAtom = atom({ plugin: 'horizon-shader', key: 'limits' } as const, [] as Limit[])
export const nowAtom = atom({ plugin: 'horizon-shader', key: 'now' } as const, 0)
export const lookAtom = atom({ plugin: 'horizon-shader', key: 'look' } as const, '')

const HOUR = 3_600_000
// Durée de chaque fenêtre : sert à savoir quelle part du temps est écoulée.
const WINDOWS: Record<string, { label: string; ms: number }> = {
  five_hour: { label: '5 h', ms: 5 * HOUR },
  seven_day: { label: 'Semaine', ms: 7 * 24 * HOUR },
}
// Écart de rythme (points de pourcentage) au-delà duquel on avertit, puis on alerte.
const WARN_PTS = 3
const ALERT_PTS = 12
// En deçà de cette part de fenêtre écoulée, la projection ne veut rien dire.
const MIN_ELAPSED = 0.04

export type Pace = {
  used: number
  // Part du temps de la fenêtre déjà écoulée, de 0 à 1 ; null sans date de réinitialisation.
  elapsed: number | null
  // Points d'avance (positif) ou de retard (négatif) sur un rythme régulier.
  delta: number | null
  // Pourcentage atteint à la réinitialisation si le rythme actuel se maintient.
  projected: number | null
  // Moment où la fenêtre serait épuisée au rythme actuel, s'il tombe avant la réinitialisation.
  exhaustAt: number | null
  level: 'ok' | 'warn' | 'alert'
}

export const pace = (l: Limit, now: number): Pace => {
  const w = WINDOWS[l.kind]
  const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN

  if (w === undefined || !Number.isFinite(reset)) {
    return { used: l.percentUsed, elapsed: null, delta: null, projected: null, exhaustAt: null, level: l.percentUsed >= 90 ? 'alert' : 'ok' }
  }
  const elapsed = Math.min(1, Math.max(0, 1 - (reset - now) / w.ms))
  const delta = l.percentUsed - elapsed * 100
  const projected = elapsed >= MIN_ELAPSED ? l.percentUsed / elapsed : null
  let exhaustAt: number | null = null

  if (projected !== null && projected > 100 && l.percentUsed < 100) {
    const start = reset - w.ms
    const ratePerMs = l.percentUsed / (now - start)
    exhaustAt = now + (100 - l.percentUsed) / ratePerMs
  }
  const level = l.percentUsed >= 90 || (projected ?? 0) > 100 || delta > ALERT_PTS ? 'alert' : delta > WARN_PTS ? 'warn' : 'ok'

  return { used: l.percentUsed, elapsed, delta, projected, exhaustAt, level }
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

// « jeu. 20 h », à l'heure locale du poste.
export const whenFr = (t: number): string => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t))
    const get = (k: string) => parts.find(p => p.type === k)?.value ?? ''
    const day = JOURS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))] ?? ''
    const min = get('minute')

    return `${day} ${Number(get('hour'))} h${min === '00' ? '' : ` ${min}`}`
  } catch {
    const d = new Date(t)
    const m = d.getMinutes()

    return `${JOURS[d.getDay()] ?? ''} ${d.getHours()} h${m === 0 ? '' : ` ${String(m).padStart(2, '0')}`}`
  }
}

// « 2 j 4 h », « 3 h 10 », « 12 min » : la durée seule, sans « dans ».
export const durFr = (ms: number): string => {
  const min = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60

  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

// « dans 2 j 4 h », « dans 3 h 10 », « dans 12 min ».
export const inFr = (ms: number): string => `dans ${durFr(ms)}`

// Formes abrégées, pour tenir dans une ligne :
// « marge 15 · fin 71 % », « avance 5 · fin 112 % », « épuisé jeu. 20 h ».
// Le rythme en deux morceaux, pour que la projection cède seule quand la place manque.
export const rhythmParts = (p: Pace): { lead: string; end: string } => {
  if (p.delta === null) {
    return { lead: '', end: '' }
  }
  if (p.exhaustAt !== null) {
    return { lead: `épuisé ${whenFr(p.exhaustAt)}`, end: '' }
  }
  const pts = Math.round(Math.abs(p.delta))
  const lead = pts <= 1 ? 'au rythme' : p.delta > 0 ? `avance ${pts}` : `marge ${pts}`

  return { lead, end: p.projected === null ? '' : ` · fin ${Math.round(p.projected)} %` }
}

export const rhythmFr = (p: Pace, _now: number): string => {
  const r = rhythmParts(p)

  return r.lead + r.end
}

// La réinitialisation : « ↻ jeu. 20 h · 3 j 10 h », ou le compte à rebours seul, « ↻ 3 j 10 h ».
export const resetFr = (reset: number, now: number): { full: string; short: string } => ({
  full: `↻ ${whenFr(reset)} · ${durFr(reset - now)}`,
  short: `↻ ${durFr(reset - now)}`,
})

// Couleurs de la bande, tirées du look actif (mode du look, accent, états).
type Colors = { fill: string[]; track: string; edge: string; mark: string; ink: string; ok: string; warn: string; alert: string }

const FALLBACK: Colors = { fill: ['#d97757'], track: '#2a2a2a', edge: '#6b6b6b', mark: '#f5f5f5', ink: '#f5f5f5', ok: '#7fc98f', warn: '#e8b45a', alert: '#ef6b5e' }

export const colorsFor = (name: string): Colors => {
  const look = LOOKS[name]

  if (look === undefined) {
    return FALLBACK
  }
  const p = look.palette
  const mode = p.only === 'light' || p.dark === undefined ? p.light : p.dark
  const roles = { ...p.roles, ...(mode?.roles ?? {}) } as Record<string, string | { seed?: string } | undefined>
  const hex = (k: string, d: string): string => {
    const r = roles[k]

    return typeof r === 'string' ? r : r?.seed ?? d
  }
  const a = mode?.gray?.anchors

  return {
    fill: look.bar ?? [hex('accent', '#d97757')],
    track: a?.['surface-0'] ?? FALLBACK.track,
    edge: a?.['text-muted'] ?? FALLBACK.edge,
    mark: a?.['text-primary'] ?? FALLBACK.mark,
    ink: a?.['text-primary'] ?? FALLBACK.ink,
    ok: hex('success', FALLBACK.ok),
    warn: hex('warning', FALLBACK.warn),
    alert: hex('danger', FALLBACK.alert),
  }
}

// La bande tient sur une seule ligne  : les deux
// fenêtres côte à côte (5 h, puis Semaine), chacune « étiquette, barre, pourcentage ». Largeurs en cellules, l'unité de
// `bodyColumns` et des `width` de Box.
const GAP_CELLS = 3
const ROW_GAP = 2
const LABEL_CELLS = 8
const PCT_CELLS = 5
// Une cellule de l'app de bureau vaut 8 px (mesuré sur une capture : une boîte de 9
// cellules et un écart de 2 occupaient 87 px).
export const CELL_PX = 8
const BAR_PX = 14

// Largeur d'un bloc : la bande moins ses marges (une cellule de chaque côté) et l'écart, en deux.
// Sans largeur connue (prop absente), on compte 80 colonnes plutôt que de tendre un NaN au moteur.
export const halfCells = (bodyColumns: number | undefined, count: number): number => {
  const cols = typeof bodyColumns === 'number' && Number.isFinite(bodyColumns) ? bodyColumns : 80

  return Math.max(16, Math.floor((cols - 2 - GAP_CELLS * (Math.max(1, count) - 1)) / Math.max(1, count)))
}

// La barre en SVG : piste, remplissage (bandes du look ou accent), repère du temps écoulé.
export const barSvg = (p: Pace, c: Colors, w = 220, h = 14): string => {
  const used = Math.min(100, Math.max(0, p.used))
  const fw = (w - 2) * (used / 100)
  const seg = c.fill.length > 1 ? (w - 2) / c.fill.length : w
  const fills = c.fill
    .map((col, i) => `<rect x="${1 + i * seg}" y="1" width="${seg + 0.5}" height="${h - 2}" fill="${col}"/>`)
    .join('')
  const mark = p.elapsed === null ? '' : `<rect x="${(1 + (w - 2) * p.elapsed - 1).toFixed(1)}" y="0" width="2" height="${h}" fill="${c.mark}"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><clipPath id="u"><rect x="1" y="1" width="${fw.toFixed(1)}" height="${h - 2}"/></clipPath></defs>` +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" fill="${c.track}" stroke="${c.edge}"/>` +
    `<g clip-path="url(#u)">${fills}</g>${mark}</svg>`
  )
}

// La barre fine du terminal en segments (utilisé, repère du temps écoulé, reste) : quatre Text au
// plus, pour rester loin des limites de taille de l'arbre de la bande.
export type Run = { kind: 'used' | 'mark' | 'rest'; n: number }

export const barRuns = (cells: number, filled: number, mark: number): Run[] => {
  const runs: Run[] = []
  const push = (kind: Run['kind'], n: number) => {
    if (n > 0) {
      runs.push({ kind, n })
    }
  }
  const kindAt = (i: number): Run['kind'] => (i < filled ? 'used' : 'rest')

  if (mark < 0 || mark >= cells) {
    push('used', filled)
    push('rest', cells - filled)

    return runs
  }
  push('used', Math.min(filled, mark))
  push('rest', Math.max(0, mark - filled))
  push('mark', 1)
  push(kindAt(mark + 1), mark + 1 < filled ? filled - mark - 1 : 0)
  push('rest', cells - Math.max(filled, mark + 1))

  return runs
}

const toLimits = (xs: readonly SessionRateLimit[]): Limit[] =>
  xs.map(x => ({ kind: x.kind, percentUsed: x.percentUsed, resetsAt: x.resetsAt }))

async function refresh($: EngineInterface): Promise<void> {
  const u = await $.session.usage()

  if (u.rateLimits.length > 0) {
    await update($, limitsAtom, () => toLimits(u.rateLimits))
  }
  await update($, nowAtom, () => Date.now())
}

// Au démarrage de la session (appelé par le session.start de register.tsx : un seul par mod).
export async function startConso($: EngineInterface): Promise<void> {
  await refresh($)
  $.clock.every(60_000, () => {
    // Une écriture de fond peut tomber après le déchargement du mod (fin de session, rechargement) :
    // son refus ne dit rien d'utile, on l'ignore.
    update($, nowAtom, () => Date.now()).catch(() => undefined)
  })
}

export const registerConso: Register = on => {
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      await update($, limitsAtom, () => toLimits(e.rateLimits))
    }
    await update($, nowAtom, () => Date.now())

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const ls = await read($, limitsAtom)
    const now = (await read($, nowAtom)) || Date.now()
    const c = colorsFor(await read($, lookAtom))
    const shown = Object.keys(WINDOWS)
      .map(kind => ls.find(l => l.kind === kind))
      .filter((l): l is Limit => l !== undefined)

    if (shown.length === 0) {
      return (
        <Box paddingX={1}>
          <Text dimColor>Consommation : en attente de la première réponse</Text>
        </Box>
      )
    }
    // Le terminal n'a pas d'Svg : la barre y devient des blocs de texte. On teste la surface, pas
    // `'Svg' in ui`, qui répond vrai aussi dans le terminal et y laissait une boîte vide.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined

    const cells = halfCells(e.props.bodyColumns, shown.length)

    const barCells = Math.max(6, cells - LABEL_CELLS - PCT_CELLS - 2 * ROW_GAP)

    const block = (l: Limit) => {
      const p = pace(l, now)
      const label = WINDOWS[l.kind]?.label ?? l.kind
      const pct = `${Math.round(p.used)} %`
      const tone = p.level === 'alert' ? c.alert : p.level === 'warn' ? c.warn : c.ok
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      const r = Number.isFinite(reset) ? resetFr(reset, now) : { full: '', short: '' }
      // Le détail (rythme, réinitialisation) reste dans le texte alternatif de la barre ; le
      // pourcentage prend la couleur d'avertissement ou de danger du look quand le rythme s'emballe.
      const detail = [rhythmFr(p, now), r.full].filter(t => t !== '').join(', ')
      const pctColor = p.level === 'ok' ? c.ink : tone
      const filled = Math.round((Math.min(100, Math.max(0, p.used)) / 100) * barCells)
      const mark = p.elapsed === null ? -1 : Math.min(barCells - 1, Math.floor(p.elapsed * barCells))

      return (
        <Box key={l.kind} width={cells} flexShrink={0} overflow="hidden">
          <Box flexDirection="row" alignItems="center" columnGap={ROW_GAP} flexWrap="nowrap">
            <Box width={LABEL_CELLS} flexShrink={0}>
              <Text bold color={c.ink}>{label}</Text>
            </Box>
            <Box flexShrink={0}>
              {Svg !== undefined ? (
                <Svg source={barSvg(p, c, barCells * CELL_PX, BAR_PX)} alt={`${label} : ${pct} utilisé${detail === '' ? '' : `, ${detail}`}`} width={barCells * CELL_PX} height={BAR_PX} />
              ) : (
                <Text wrap="truncate-end">
                  {barRuns(barCells, filled, mark).map((run, i) => (
                    <Text key={String(i)} color={run.kind === 'mark' ? c.mark : run.kind === 'used' ? c.fill[0] : undefined} dimColor={run.kind === 'rest'}>
                      {(run.kind === 'mark' ? '│' : run.kind === 'used' ? '█' : '░').repeat(run.n)}
                    </Text>
                  ))}
                </Text>
              )}
            </Box>
            <Box width={PCT_CELLS} flexShrink={0} justifyContent="flex-end">
              <Text bold color={pctColor}>{pct}</Text>
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" paddingX={1} columnGap={GAP_CELLS} flexWrap="nowrap">
        {shown.map(block)}
      </Box>
    )
  })
}

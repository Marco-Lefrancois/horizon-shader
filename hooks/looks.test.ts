import { expect, test } from 'claude-code/testing'

import { barRuns, barSvg, colorsFor, halfCells, inFr, pace, resetFr, rhythmFr } from './conso.js'
import { ETAT0, rythmeOf } from './vivant.js'

type Theme = { colors?: { id?: string }; backdrop?: { scene?: string } }

// Deux fenêtres : 34 % de la semaine, réinitialisée dans 3,5 jours (donc à mi-fenêtre).
const NOW = Date.parse('2026-11-16T12:00:00Z')
const WEEK = { kind: 'seven_day', percentUsed: 34, resetsAt: new Date(NOW + 3.5 * 24 * 3_600_000).toISOString() }
const FIVE = { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 2.5 * 3_600_000).toISOString() }
const LIMITS = [WEEK, FIVE]

// Le moteur sous le mod : chaque appel sur `$` est répondu ici, et on note les thèmes posés.
// Le banc d'essai refuse tout arrière-plan avant d'arriver ici : on voit donc le repli sur
// les couleurs seules, que le mod fait exprès.
// `drawn: false` joue une session sans client qui dessine les thèmes (le terminal).
// Le banc d'essai répond à `$` par ces hooks ; leurs types exacts suivent le build, d'où `On` lâche.
type On = (event: string, hook: (...args: never[]) => unknown) => void

const engine = (on: On, themes: Theme[], store: Record<string, unknown>, drawn = true, statuses: (string | undefined)[] = []) => {
  on('ui.status', (_, e) => {
    statuses.push((e as { text?: string }).text)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'look' } }))
  on('theme.set', (_, e) => {
    themes.push(e as Theme)

    return { value: drawn ? { isDrawn: true } : { isDrawn: false, reason: 'no attached desktop or mobile client draws themes yet' } }
  })
  on('theme.clear', () => ({ value: {} }))
  on('store.get', (_, e) => ({ value: store[(e as { key: string }).key] }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store[key] = value

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: (e as { cwd: string }).cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: LIMITS } }))
  on('clock.every', () => ({ value: undefined }))
}

test('sans choix retenu, Horizon se pose au démarrage', async ($, on) => {
  const themes: Theme[] = []
  engine(on as On, themes, {})

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(themes.at(-1)?.colors?.id).toBe('horizon')
})

// Un look retenu qui n'existe pas (ou plus) retombe sur Horizon.
for (const old of ['ancien', 'goby']) {
  test(`un ancien choix retiré (${old}) retombe sur Horizon`, async ($, on) => {
    const themes: Theme[] = []
    engine(on as On, themes, { look: old })

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(themes.at(-1)?.colors?.id).toBe('horizon')
  })
}

test('/look fixe et /look anime se retiennent, en marche par défaut', async ($, on) => {
  const store: Record<string, unknown> = { look: 'horizon' }
  engine(on as On, [], store)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const before = await $.command.run({ command: 'look', args: '' } as never)
  const fixe = await $.command.run({ command: 'look', args: 'fixe' } as never)
  const after = await $.command.run({ command: 'look', args: '' } as never)
  const anime = await $.command.run({ command: 'look', args: 'anime' } as never)

  expect(store.animation).toBe('anime')
  expect(before.text).toContain('Animation des scènes : en marche')
  expect(fixe.text).toContain('Animation arrêtée.')
  expect(after.text).toContain('Animation des scènes : arrêtée')
  expect(anime.text).toContain('Animation remise.')
})

test('un /look fixe gardé reste arrêté à la session suivante', async ($, on) => {
  const store: Record<string, unknown> = { look: 'horizon', animation: 'fixe' }
  engine(on as On, [], store)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const listing = await $.command.run({ command: 'look', args: '' } as never)

  expect(listing.text).toContain('Animation des scènes : arrêtée')
})

test('aucun retenu reste sans thème à la session suivante', async ($, on) => {
  const themes: Theme[] = []
  engine(on as On, themes, { look: 'aucun' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(themes).toEqual([])
})

test('/look seul liste la librairie, un nom inconnu est refusé, aucun retire le thème', async ($, on) => {
  const store: Record<string, unknown> = { look: 'horizon' }
  engine(on as On, [], store)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const list = await $.command.run({ command: 'look', args: '' } as never)
  const bad = await $.command.run({ command: 'look', args: 'goby' } as never)
  const none = await $.command.run({ command: 'look', args: 'aucun' } as never)

  expect(list.text).toContain('● horizon')
  expect(list.text).toContain('○ aucun')
  expect(bad.text).toContain('Look inconnu : goby.')
  expect(none.text).toContain('Look retiré')
  expect(store.look).toBe('aucun')
})

// Le seul look de la librairie s'applique sans refus de l'app et pose sa palette.
const LOOK_IDS: Record<string, string> = {
  horizon: 'horizon',
}

for (const [name, id] of Object.entries(LOOK_IDS)) {
  test(`/look ${name} pose la palette ${id}`, async ($, on) => {
    const themes: Theme[] = []
    const store: Record<string, unknown> = {}
    engine(on as On, themes, store)

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ran = await $.command.run({ command: 'look', args: name } as never)

    expect(ran.text).toContain('Look appliqué')
    expect(store.look).toBe(name)
    expect(themes.at(-1)?.colors?.id).toBe(id)
  })
}

// Bande de consommation : le rythme compare la part utilisée à la part du temps écoulée.
test('rythme : 34 % à mi-semaine laisse une marge de 16 pts, fin à 68 %', () => {
  const p = pace(WEEK, NOW)

  expect(p.elapsed).toBe(0.5)
  expect(Math.round(p.delta ?? 0)).toBe(-16)
  expect(p.level).toBe('ok')
  expect(rhythmFr(p, NOW)).toBe('marge 16 · fin 68 %')
})

test('rythme : 80 % à mi-fenêtre de 5 h annonce l’épuisement avant la réinitialisation', () => {
  const p = pace(FIVE, NOW)

  expect(p.level).toBe('alert')
  expect(p.exhaustAt).not.toBeNull()
  // 80 % en 2,5 h : les 20 % restants partent en 37,5 min.
  expect(Math.round(((p.exhaustAt ?? 0) - NOW) / 60000)).toBe(38)
  expect(rhythmFr(p, NOW)).toContain('épuisé')
})

test('durées et barre : formats lisibles, couleurs du look', () => {
  expect(inFr(3.5 * 24 * 3_600_000)).toBe('dans 3 j 12 h')
  expect(inFr(130 * 60000)).toBe('dans 2 h 10')
  // Horizon n'a pas de bandes de barre : son accent corail remplit la barre.
  expect(colorsFor('horizon').fill).toEqual(['#e07a62'])
  expect(barSvg(pace(WEEK, NOW), colorsFor('horizon'))).toContain('#e07a62')
})

test('la bande montre les deux fenêtres au démarrage', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'horizon-shader', component: 'AbovePrompt', props: { hasSurvey: false }, surface: 'desktop' } as never)

  expect(await ui.find({ type: 'Text', text: 'Semaine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '34 %' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '80 %' })).toBeDefined()
  await ui.unmount()
})

// Une seule ligne : les deux fenêtres côte à côte, chacune dans la moitié de la bande.
test('largeur d’un bloc : la moitié de la bande, au moins 16 cellules', () => {
  expect(halfCells(94, 2)).toBe(44)
  expect(halfCells(20, 2)).toBe(16)
  expect(halfCells(undefined, 2)).toBe(halfCells(80, 2))
})

test('barre du terminal : segments utilisé, repère, reste', () => {
  expect(barRuns(10, 4, 6)).toEqual([{ kind: 'used', n: 4 }, { kind: 'rest', n: 2 }, { kind: 'mark', n: 1 }, { kind: 'rest', n: 3 }])
  expect(barRuns(10, 7, 3)).toEqual([{ kind: 'used', n: 3 }, { kind: 'mark', n: 1 }, { kind: 'used', n: 3 }, { kind: 'rest', n: 3 }])
  expect(barRuns(10, 4, -1)).toEqual([{ kind: 'used', n: 4 }, { kind: 'rest', n: 6 }])
})

test('textes abrégés : réinitialisation complète et courte', () => {
  const r = resetFr(NOW + (3 * 24 + 10) * 3_600_000, NOW)
  expect(r.short).toBe('↻ 3 j 10 h')
  expect(r.full.endsWith(' · 3 j 10 h')).toBe(true)
})

// Terminal : le look est retenu sans être dessiné ; la bande y montre sa barre en blocs de texte.
test('terminal : /look dit en français que le look est retenu pour l’app', async ($, on) => {
  engine(on as On, [], { look: 'aucun' }, false)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const said = await $.command.run({ command: 'look', args: 'horizon' } as never)

  expect(said.text).toContain('Horizon retenu')
  expect(said.text).toContain('seule la bande en prend les couleurs')
  expect(said.text).not.toContain('no attached')
})

test('terminal : la barre de la bande est en blocs, sans Svg', async ($, on) => {
  engine(on as On, [], { look: 'horizon' }, false)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'horizon-shader', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 }, surface: 'terminal' } as never)

  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// Une ligne d'état posée par une version précédente du mod survit au rechargement : le démarrage l'efface.
test('terminal : le démarrage efface la barre d’état quand le look est seulement retenu', async ($, on) => {
  const statuses: (string | undefined)[] = []
  engine(on as On, [], { look: 'horizon' }, false, statuses)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(statuses).toEqual([undefined])
})

// Horizon : le ciel fonce avec le rythme de 5 h, aux seuils de la bande.
test('Horizon : rythme nul en marge, plein quand la fenêtre de 5 h s’épuise', () => {
  // 80 % à mi-fenêtre de 5 h : 30 pts d'avance.
  expect(rythmeOf(LIMITS, NOW)).toBe(1)
  // Seule la semaine (en marge) : rien à signaler au ciel.
  expect(rythmeOf([WEEK], NOW)).toBe(0)
  // 57,5 % à mi-fenêtre : 7,5 pts d'avance, la moitié du chemin entre 3 et 12.
  const mid = [{ kind: 'five_hour', percentUsed: 57.5, resetsAt: FIVE.resetsAt }]
  expect(Math.round(rythmeOf(mid, NOW) * 100) / 100).toBe(0.5)
})

// Horizon : l'état que lit le shader suit les tours et les outils.
test('Horizon : un tour fait travailler la plaine, une question allume le phare', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })
  // L'état de la session, tenu ici à la place du moteur, pour lire ce que le mod y écrit.
  const mem = new Map<string, unknown>()
  let version = 0
  on('state.get', (_, e) => ({ value: { value: mem.get((e as { key: string }).key), version } }))
  on('state.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    mem.set(key, value)
    version += 1

    return { value: { isSet: true, version } }
  })
  // Un atome à forme garde sa valeur sous `value`, avec l'étiquette `shape`.
  const lire = async (): Promise<typeof ETAT0> => {
    const raw = mem.get('vivant') as { value?: typeof ETAT0 } | typeof ETAT0 | undefined

    return ((raw !== undefined && 'value' in raw ? raw.value : raw) as typeof ETAT0 | undefined) ?? ETAT0
  }
  // Ce que voit le shader pendant que la question attend la personne.
  let pendant = ETAT0
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.run', async () => {
    pendant = await lire()

    return { result: 'ok' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'bonjour', turnId: 't1' })
  expect((await lire()).travail).toBe(1)

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  expect(pendant.attente).toBe(1)
  expect(pendant.travail).toBe(0)
  const après = await lire()
  expect(après.attente).toBe(0)
  expect(après.travail).toBe(1)
})

// L'état de la session tenu par le banc, et chaque écriture du mod, pour suivre le phare.
const etatSuivi = (on: On) => {
  const mem = new Map<string, unknown>()
  const ecrits: (typeof ETAT0)[] = []
  let version = 0
  const valeur = (raw: unknown): typeof ETAT0 =>
    ((raw !== undefined && raw !== null && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw) as typeof ETAT0 | undefined) ?? ETAT0

  on('state.get', (_, e) => ({ value: { value: mem.get((e as { key: string }).key), version } }))
  on('state.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    mem.set(key, value)
    version += 1
    if (key === 'vivant') {
      ecrits.push(valeur(value))
    }

    return { value: { isSet: true, version } }
  })

  return { lire: () => valeur(mem.get('vivant')), ecrits }
}

test('Horizon : un sous-agent en arrière-plan fait défiler la plaine après le tour principal', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })
  const etat = etatSuivi(on as On)
  // Ce que le moteur dit des sous-agents : un en arrière-plan qui tourne encore.
  let agents = [{ id: 'a1', description: 'fouille', type: 'Explore', status: 'running' }]
  // Seuls les champs que lit le mod ; les autres du type AgentInfo ne servent pas ici.
  on('agent.list', () => ({ value: agents as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'lance la fouille', turnId: 't1' })
  await $.turn.start({ text: 'fouille', turnId: 's1', agentId: 'a1' } as never)
  await $.turn.complete({ reason: 'answer' } as never)

  // Le tour principal est fini, le sous-agent travaille encore : la plaine défile, son étoile reste.
  expect(etat.lire().travail).toBe(1)
  expect(etat.lire().aides).toBe(1)

  agents = []
  await $.turn.complete({ reason: 'answer', agentId: 'a1' } as never)
  expect(etat.lire().travail).toBe(0)
  expect(etat.lire().aides).toBe(0)
})

test('Horizon : sans liste des sous-agents, la fin du tour arrête la plaine', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })
  const etat = etatSuivi(on as On)
  on('agent.list', () => {
    throw new Error('indisponible')
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'bonjour', turnId: 't1' })
  await $.turn.start({ text: 'aide', turnId: 's1', agentId: 'a1' } as never)
  await $.turn.complete({ reason: 'answer' } as never)

  expect(etat.lire().travail).toBe(0)
  expect(etat.lire().aides).toBe(0)
})

test('Horizon : une demande d’autorisation allume le phare jusqu’à la réponse', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })
  const etat = etatSuivi(on as On)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // Le moteur : la règle demande l'avis de la personne, puis l'outil tourne une fois accepté.
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.run', () => ({ result: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'liste les fichiers', turnId: 't1' })
  const debut = etat.ecrits.length

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)

  const pendant = etat.ecrits.slice(debut)
  expect(pendant.some(s => s.attente === 1 && s.travail === 0)).toBe(true)
  expect(etat.lire().attente).toBe(0)
  expect(etat.lire().travail).toBe(1)
})

test('Horizon : une autorisation refusée éteint le phare', async ($, on) => {
  engine(on as On, [], { look: 'horizon' })
  const etat = etatSuivi(on as On)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'ask' }))
  // La personne refuse : le moteur ne lance pas l'outil.
  on('tool.run', () => ({ deny: 'refusé par la personne' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'pousse', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never).catch(() => undefined)

  expect(etat.lire().attente).toBe(0)
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { registerConso, startConso } from './conso.js'
import { ETAT0, measureVivant, registerVivant, rythmeOf } from './vivant.js'
import type { Limit } from '../types'

// Le look actif, lu par la bande de consommation (conso.tsx) pour prendre ses couleurs.
const lookAtom = atom({ plugin: 'horizon-shader', key: 'look' } as const, '')
// Lus par le shader d'Horizon : l'état de la session (écrit par vivant.ts) et les limites de la bande
// (écrites par conso.tsx). Le moteur ne lit un atome que déclaré dans le fichier qui le lit.
const vivantAtom = atom({ plugin: 'horizon-shader', key: 'vivant' } as const, ETAT0, { shape: 'vivant-1' })
const limitsAtom = atom({ plugin: 'horizon-shader', key: 'limits' } as const, [] as Limit[])
const nowAtom = atom({ plugin: 'horizon-shader', key: 'now' } as const, 0)

import { DEFAULT_LOOK, LOOKS } from './library.js'
import { makeColors } from './make-colors.js'

// Librairie de looks : /look liste, /look <nom> applique et retient le choix (store du mod,
// gardé d'une session à l'autre), /look aucun rend le look de l'app.
const STORE_KEY = 'look'
const NONE = 'aucun'
// Animation des scènes : au repos par défaut ;
// `/look anime` la remet, `/look fixe` l'arrête. Le choix est gardé dans le store.
const ANIM_KEY = 'animation'
const FIXE = 'fixe'
const ANIME = 'anime'

// Arrête toute animation d'une scène : la même règle que prefers-reduced-motion, posée d'office.
const freeze = (svg: string): string =>
  svg.replace('</style>', '*{animation:none!important}</style>')

const isAnimated = async ($: EngineInterface): Promise<boolean> => (await $.store.get(ANIM_KEY)) === ANIME

// La scène en cours, lue par le hook Backdrop ; posée à chaque application.
let currentScene: string | undefined
let currentAlt = ''
// Le shader du look en cours, s'il en a un (Horizon), et si l'animation est en marche.
let currentShader: 'horizon' | undefined
let currentAnimated = false

// Mot qui marque un look retenu mais que la surface ne dessine pas (terminal, éditeurs).
const RETAINED = 'retenu'

const apply = async ($: EngineInterface, name: string): Promise<string> => {
  const look = LOOKS[name]

  if (look === undefined) {
    return `Look inconnu : ${name}.`
  }
  const { theme, problems } = makeColors(look.palette)
  const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

  if (unpainted !== undefined) {
    return `${look.title} refusé : ${unpainted}`
  }
  currentAnimated = await isAnimated($)
  currentShader = look.shader
  currentScene = look.scene === undefined || currentAnimated ? look.scene : freeze(look.scene)
  currentAlt = look.alt ?? look.title
  const args: ThemeSetArgs = {
    colors: theme,
    // Un look d'un seul mode le dit par `only` dans sa palette : ce build refuse overrideColorScheme.
    backdrop: look.scene !== undefined ? { scene: `look-${name}`, glass: look.glass } : (look.ground ?? { color: 'surface-0' }),
  }
  let set: Awaited<ReturnType<EngineInterface['theme']['set']>>
  let note = ''

  try {
    set = await $.theme.set(args)
  } catch (err) {
    // Un hôte qui refuse l'arrière-plan (le banc d'essai de `claude plugin test` le fait) :
    // on garde au moins les couleurs, et on dit pourquoi la scène manque.
    currentScene = undefined
    currentShader = undefined
    set = await $.theme.set({ colors: theme })
    note = ` (scène refusée par l'hôte : ${String(err instanceof Error ? err.message : err).slice(0, 120)})`
  }

  // La bande de consommation prend les couleurs du look appliqué.
  await update($, lookAtom, () => name)

  return set.isDrawn
    ? `Look appliqué : ${look.title}.${note}`
    : `${look.title} ${RETAINED} : l'app de bureau et le mobile le dessinent ; ici, seule la bande en prend les couleurs.`
}

const listing = (current: string, animated: boolean): string =>
  [
    'Looks disponibles (/look <nom>) :',
    ...Object.entries(LOOKS).map(([name, look]) => `${name === current ? '●' : '○'} ${name} : ${look.title}. ${look.description}`),
    `${current === NONE ? '●' : '○'} ${NONE} : le look de l'app, sans thème.`,
    `Animation des scènes : ${animated ? 'en marche (/look fixe pour l\'arrêter)' : 'arrêtée (/look anime pour la remettre)'}.`,
  ].join('\n')

export const register: Register = (on, options) => {
  // Bande de consommation (conso.tsx), aux couleurs du look actif.
  registerConso(on, options)
  // État de la session suivi par le shader d'Horizon (vivant.ts).
  registerVivant(on, options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'look',
      description: 'Choisir le look de Claude Code dans la librairie',
      argumentHint: `[${[...Object.keys(LOOKS), NONE, FIXE, ANIME].join(' | ')}]`,
    })
    const saved = (await $.store.get(STORE_KEY)) as string | undefined
    const name = saved ?? DEFAULT_LOOK

    if (name !== NONE) {
      const said = await apply($, LOOKS[name] !== undefined ? name : DEFAULT_LOOK)

      // La barre d'état ne dit que les refus ; sinon on l'efface, car une ligne posée par une
      // version précédente du mod survit à son rechargement à chaud.
      $.ui.status(said.startsWith('Look appliqué') || said.includes(RETAINED) ? undefined : said)
    }
    const r = await next(e)

    await startConso($)
    await measureVivant($).catch(() => undefined)

    return r
  })

  on('command.run', { command: 'look' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const current = ((await $.store.get(STORE_KEY)) as string | undefined) ?? DEFAULT_LOOK

    if (wanted === '') {
      return { text: listing(current, await isAnimated($)) }
    }
    if (wanted === FIXE || wanted === ANIME) {
      await $.store.set(ANIM_KEY, wanted)

      if (current === NONE || LOOKS[current] === undefined) {
        return { text: wanted === FIXE ? 'Animation arrêtée.' : 'Animation remise.' }
      }
      const said = await apply($, current)

      return { text: `${wanted === FIXE ? 'Animation arrêtée' : 'Animation remise'}. ${said}` }
    }
    if (wanted === NONE) {
      currentScene = undefined
      currentShader = undefined
      await update($, lookAtom, () => '')
      await $.store.set(STORE_KEY, NONE)
      await $.theme.clear()
      $.ui.status(undefined)

      return { text: "Look retiré : l'app reprend le sien." }
    }
    if (LOOKS[wanted] === undefined) {
      return { text: `Look inconnu : ${wanted}.\n${listing(current, await isAnimated($))}` }
    }
    const said = await apply($, wanted)

    // Un look qui passe efface un refus resté dans la barre d'état.
    if (said.startsWith('Look appliqué') || said.includes(RETAINED)) {
      $.ui.status(undefined)
    }
    await $.store.set(STORE_KEY, wanted)

    return { text: said }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || !e.props.scene.startsWith('look-') || currentScene === undefined) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const still = <ui.Svg source={currentScene} alt={currentAlt} isInteractive />

    // Un Claude Code sans shader ne donne pas d'élément Shader : la scène SVG suffit.
    if (currentShader !== 'horizon' || !('Shader' in ui) || ui.Shader === undefined) {
      return still
    }
    const { Shader } = ui
    // `/look fixe` : le shader garde l'état lisible par les couleurs, sans aucun mouvement.
    const now = (await read($, nowAtom)) || Date.now()
    const values = { ...(await read($, vivantAtom)), rythme: rythmeOf(await read($, limitsAtom), now), calme: currentAnimated ? 0 : 1 }

    return (
      <Shader module="./horizon-shader.ts" values={values}>
        {still}
      </Shader>
    )
  })
}

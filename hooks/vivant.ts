import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Etat, Limit } from '../types'
import { pace } from './conso.js'

// L'état de la session que suit le shader d'Horizon (horizon-shader.ts) : le soleil descend avec le contexte, la plaine défile pendant que le modèle travaille,
// un phare bat quand Claude l'attend. Le mod n'écrit que des changements d'état ; l'app passe d'une
// valeur à l'autre en douceur. Les autres looks ignorent cet état.

export const ETAT0: Etat = { contexte: 0, travail: 0, attente: 0, aides: 0, outils: 0, ennui: 0 }
const vivantAtom = atom({ plugin: 'horizon-shader', key: 'vivant' } as const, ETAT0, { shape: 'vivant-1' })

// Sous-agents au travail (dont ceux en arrière-plan, qui continuent après le tour principal),
// outils en vol, et demande d'autorisation affichée. Variables du module : un rechargement
// les remet à zéro, et l'état publié se corrige au prochain événement.
const helpers = new Set<string>()
let toolsInFlight = 0
let turnActive = false
let permissionAsked = false

// Outils qui rendent la main à la personne : Claude l'attend.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])

// États d'un sous-agent qui travaille encore (AgentStatus) ; `idle` attend un message, il ne travaille pas.
const AT_WORK = new Set(['pending', 'running', 'waiting'])

// La plaine défile tant que le tour principal ou un sous-agent travaille, sauf si Claude attend la personne.
const working = (): 0 | 1 => (!permissionAsked && (turnActive || helpers.size > 0) ? 1 : 0)

// Recale les sous-agents sur ce que le moteur en dit : un tour perdu (rechargement, arrêt) ne laisse
// pas la plaine défiler pour rien, et un sous-agent en arrière-plan reste compté après le tour principal.
const syncHelpers = async ($: EngineInterface): Promise<void> => {
  const agents = await $.agent.list()

  helpers.clear()
  for (const a of agents) {
    if (AT_WORK.has(a.status)) {
      helpers.add(a.id)
    }
  }
}

// Rythme de la fenêtre de 5 h, de 0 à 1, sur l'avance en points des seuils de la bande (conso.tsx) :
// 3 points ou moins donnent 0, 12 ou plus donnent 1, comme 90 % utilisés. La projection n'entre pas
// en compte : toute avance la porte au-delà de 100 %, le ciel serait tout ou rien.
export const rythmeOf = (limits: readonly Limit[], now: number): number => {
  const l = limits.find(x => x.kind === 'five_hour')

  if (l === undefined) {
    return 0
  }
  const p = pace(l, now)

  if (p.used >= 90) {
    return 1
  }

  return p.delta === null ? 0 : Math.min(1, Math.max(0, (p.delta - 3) / 9))
}

const set = async ($: EngineInterface, patch: Partial<Etat>): Promise<void> => {
  await update($, vivantAtom, (e: Etat): Etat => {
    const next = { ...e, ...patch }

    return (Object.keys(next) as (keyof Etat)[]).some(k => next[k] !== e[k]) ? next : e
  })
}

// Le remplissage du contexte. Le rythme, lui, se calcule au dessin depuis l'état de la bande
// (conso.tsx), qui tient déjà le seul hook `session.measure` permis au mod.
export async function measureVivant($: EngineInterface): Promise<void> {
  const u = await $.session.usage()

  if (u.context.percent !== undefined) {
    await set($, { contexte: Math.min(1, Math.max(0, u.context.percent / 100)) })
  }
}

export const registerVivant: Register = on => {
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      helpers.add(e.agentId)
      await set($, { aides: Math.min(4, helpers.size), travail: working() })

      return next(e)
    }
    turnActive = true
    toolsInFlight = 0
    permissionAsked = false
    await set($, { travail: 1, attente: 0, outils: 0, ennui: 0 })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      helpers.delete(e.agentId)
      await set($, { aides: Math.min(4, helpers.size), travail: working() })

      return next(e)
    }
    turnActive = false
    toolsInFlight = 0
    permissionAsked = false
    // Les sous-agents en arrière-plan continuent après le tour principal : on les garde.
    // Sans liste du moteur, on retombe sur l'ancien comportement (plus aucun).
    await syncHelpers($).catch(() => helpers.clear())
    await set($, {
      travail: working(),
      attente: 0,
      outils: 0,
      aides: Math.min(4, helpers.size),
      ennui: e.reason === 'error' || e.reason === 'refusal' ? 1 : 0,
    })
    // Le remplissage du contexte après la réponse (et après une compaction, qui le fait chuter).
    await measureVivant($).catch(() => undefined)

    return next(e)
  })

  // Observe seulement : un échec du hook laisse l'outil passer tel quel.
  on('tool.call', async ($, e, next) => {
    if (ASKS.has(e.tool)) {
      await set($, { attente: 1, travail: 0 })
      const r = await next(e)

      await set($, { attente: 0, travail: working() })

      return r
    }
    toolsInFlight += 1
    await set($, { outils: 1 })
    const r = await next(e)

    toolsInFlight = Math.max(0, toolsInFlight - 1)
    // Une autorisation refusée ne passe pas par `tool.run` : le phare s'éteint ici.
    if (permissionAsked) {
      permissionAsked = false
      await set($, { attente: 0, travail: working() })
    }
    if (toolsInFlight === 0) {
      await set($, { outils: 0 })
    }

    return r
  }).catch(($, e, next) => next(e))

  // Une demande d'autorisation va s'afficher : le verdict est `ask`, sur un vrai appel (pas une
  // requête). Le phare bat jusqu'à la réponse. `approver` n'est pas exigé : le banc d'essai ne le
  // donne pas, et un `ask` sans personne pour répondre (claude -p, sans scène) s'éteint à la fin
  // de l'appel. Observe seulement : le verdict passe tel quel, et un échec du hook aussi.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (verdict.decision === 'ask' && e.tool_use_id !== undefined && !ASKS.has(e.tool)) {
      permissionAsked = true
      await set($, { attente: 1, travail: 0 })
    }

    return verdict
  })

  // En mode auto, le classifieur tranche souvent seul : s'il donne un verdict, personne n'est attendu.
  on('tool.judge', async ($, e, next) => {
    const verdict = await next(e)

    if (permissionAsked && verdict.decision !== 'ask') {
      permissionAsked = false
      await set($, { attente: 0, travail: working() })
    }

    return verdict
  })

  // L'appel est autorisé et va tourner : la personne a répondu (ou personne n'était attendu).
  on('tool.run', async ($, e, next) => {
    if (permissionAsked) {
      permissionAsked = false
      await set($, { attente: 0, travail: working() }).catch(() => undefined)
    }

    return next(e)
  })
}

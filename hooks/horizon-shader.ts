// Horizon (shader) : la scène Horizon redessinée sur le GPU, réglée par l'état de la session.
// Le mod n'envoie que des états (jamais un flux sur minuterie) ; l'app passe en douceur d'une valeur
// à l'autre. Ce qui avance avec le temps (la plaine qui défile, les éclats d'outils) se cumule dans
// un petit tampon, avancé de `dt`.
//
// Repère : `p.point` en points, x vers la droite, y vers le HAUT (convention GPU ; à confirmer à l'œil).
import {
  abs, buffer, clamp, dt, floor, fract, fwidth, length, max, min, mix, mod, picture, pow, range, shader, sin, size,
  smoothstep, still, time, vec2, vec3, vec4, values,
} from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

// contexte : remplissage de la fenêtre de contexte (0 vide, 1 plein) ; le soleil descend avec lui.
// travail : un tour du modèle est en cours ; la plaine défile vers soi.
// attente : Claude attend une réponse (question, plan) ; un phare clignote sur l'horizon.
// rythme : la consommation de 5 h file plus vite que le temps ; le ciel fonce.
// aides : sous-agents au travail, de 0 à 4 ; une étoile chacun.
// outils : un outil tourne ; des éclats filent le long des lignes de fuite.
// ennui : le dernier tour a fini sur une erreur ; l'horizon rougit.
// calme : `/look fixe` ; aucun mouvement, l'état reste lisible par les couleurs.
const v = values({
  contexte: [0, 1],
  travail: [0, 1],
  attente: [0, 1],
  rythme: [0, 1],
  aides: [0, 4],
  outils: [0, 1],
  ennui: [0, 1],
  calme: [0, 1],
})

const SKY = vec3(0.722, 0.29, 0.227) // #b84a3a
const SKY_LATE = vec3(0.42, 0.17, 0.27) // ciel qui fonce quand le rythme s'emballe
const GLOW = vec3(0.86, 0.42, 0.29) // bandes de couchant près de l'horizon
const SUN = vec3(0.937, 0.902, 0.816) // #efe6d0
const SUN_LOW = vec3(0.96, 0.66, 0.45) // soleil couchant
const PLAIN = vec3(0.133, 0.149, 0.29) // #22264a
const GRID = vec3(0.227, 0.247, 0.416) // #3a3f6a
const GRID_LIT = vec3(0.878, 0.478, 0.384) // #e07a62, l'accent du look
const BEACON = vec3(0.91, 0.706, 0.353) // #e8b45a
const SPARK = vec3(0.98, 0.86, 0.62)
const ALARM = vec3(0.937, 0.31, 0.31) // #ef4f4f

// La part de hauteur occupée par la plaine, comme dans la scène SVG (62 % de ciel).
const HORIZON = 0.38
// Point de fuite, en part de largeur (620 sur 1000 dans la scène SVG).
const VANISH = 0.62

// Mouvement permis : ni en `/look fixe`, ni sous « réduire les animations ».
const moving = (): number => (1 - v.calme) * (1 - still)

// x : avancée de la plaine ; y : avancée des éclats d'outils. Deux nombres qui tournent de 0 à 1.
const pace: Buffer = buffer({ size: [1, 1], float: 32, filter: 'nearest' }, (): vec4 => {
  const s = pace.at(vec2(0, 0))
  const m = moving()
  const travel = fract(s.x + dt * 0.32 * v.travail * m)
  const flux = fract(s.y + dt * 0.55 * v.outils * m)

  return vec4(travel, flux, 0, 1)
})

// Une ligne nette d'environ un point et demi, quelle que soit la profondeur.
const lineOf = (phase: number, width: number): number => {
  const f = fract(phase)
  const d = min(f, 1 - f)

  return clamp(width - d / max(fwidth(phase), 0.0001), 0, 1)
}

// 1 dans la fente (la part basse de chaque période), 0 ailleurs, adouci d'un pixel.
function step01(f: number, gap: number): number {
  return clamp((gap - f) / max(fwidth(f), 0.0001) + 0.5, 0, 1)
}

const view = picture(p => {
  const at = p.point
  const w = size.x
  const h = size.y
  const horizonY = h * HORIZON
  const m = moving()
  const s = pace.at(vec2(0, 0))

  // Le soleil, placé comme dans la scène SVG : un carré de 400 calé en haut à droite.
  const k = min((w * 0.55) / 400, (h * 0.62) / 400)
  const sunX = w - 150 * k
  const sunHigh = h - 170 * k
  const sunR = 48 * k
  const bob = 3 * sin(time * 0.24) * m
  const sunY = mix(sunHigh, horizonY, v.contexte) + bob

  let rgb = vec3(0, 0, 0)

  if (at.y >= horizonY) {
    // Ciel : brique, plus sombre quand le rythme s'emballe ; trois bandes de couchant près de
    // l'horizon, à paliers comme une sérigraphie, qui s'allument à mesure que le soleil descend.
    rgb = mix(SKY, SKY_LATE, v.rythme * 0.75)
    const above = (at.y - horizonY) / h
    const band = floor(above / 0.03)
    const glow = band < 3 ? (1 - band / 3) * 0.55 * v.contexte : 0
    rgb = mix(rgb, GLOW, glow)

    // Étoiles : une par sous-agent, en haut à gauche du soleil.
    for (const i of range(4)) {
      const sx = w - (330 - i * 52) * k
      const sy = h - (40 + mod(i, 2) * 46) * k
      const on = smoothstep(i + 0.2, i + 0.8, v.aides)
      const twinkle = 0.8 + 0.2 * sin(time * (1.3 + i * 0.4) + i) * m
      const d = length(vec2(at.x - sx, at.y - sy))
      const star = clamp(2.2 - d, 0, 1) + clamp(1 - d / 9, 0, 1) * 0.25
      rgb = mix(rgb, SPARK, clamp(star * on * twinkle, 0, 1))
    }

    // Soleil : disque crème qui se réchauffe en descendant ; des fentes s'ouvrent dans sa moitié
    // basse quand il approche de l'horizon.
    const ds = length(vec2(at.x - sunX, at.y - sunY)) - sunR
    const disc = clamp(0.5 - ds, 0, 1)
    const below = (sunY - at.y) / sunR
    const slit = below > 0.1 ? step01(fract(below * 4.5), 0.18 + 0.5 * v.contexte * below) : 0
    const sunColor = mix(SUN, SUN_LOW, pow(v.contexte, 1.5) * 0.8)
    rgb = mix(rgb, sunColor, disc * (1 - slit))
  } else {
    // Plaine marine en perspective : d vaut 0 à l'horizon et 1 au pied.
    rgb = PLAIN
    const d = (horizonY - at.y) / horizonY
    const fade = smoothstep(0.0, 0.1, d)

    // Lignes transversales : elles viennent vers soi quand la plaine avance.
    const depth = 1 / (d + 0.04)
    const across = lineOf(depth * 0.36 - s.x, 1.1)

    // Lignes de fuite vers le point de fuite.
    const spread = (w * 0.16 * (d + 0.0375)) / 1.0375
    const u = (at.x - w * VANISH) / spread
    const along = lineOf(u + 0.5, 1.1)

    const grid = max(across, along) * fade
    const lit = 0.25 + 0.75 * v.travail
    rgb = mix(rgb, mix(GRID, GRID_LIT, v.travail * 0.55), grid * lit + grid * 0.35 * (1 - lit))

    // Éclats d'outils : des traits clairs qui descendent les lignes de fuite pendant qu'un outil tourne.
    const lane = floor(u + 0.5)
    const dash = pow(1 - fract(depth * 0.12 - s.y * 2 + lane * 0.37), 10)
    rgb = mix(rgb, SPARK, along * fade * dash * v.outils * 0.9)

    // Reflet du soleil sur la plaine, qui suit sa hauteur.
    const rx = abs(at.x - sunX) / (sunR * 0.9)
    const ry = d
    const reflet = clamp(1 - rx, 0, 1) * clamp(1 - ry * 2.5, 0, 1) * (0.12 + 0.25 * v.contexte)
    rgb = mix(rgb, SUN_LOW, reflet)
  }

  // La ligne d'horizon : discrète, rouge sur une erreur.
  const hl = clamp(1.2 - abs(at.y - horizonY), 0, 1)
  rgb = mix(rgb, mix(GRID_LIT, ALARM, v.ennui), hl * (0.35 + 0.65 * v.ennui))

  // Phare d'attente au point de fuite : lent (moins d'un battement par seconde), fixe sans mouvement.
  const bx = w * VANISH
  const db = length(vec2(at.x - bx, (at.y - horizonY) * 1.6))
  const beat = mix(1, 0.55 + 0.45 * sin(time * 2.4), m)
  const beam = (clamp(4 - db, 0, 1) + clamp(1 - db / 34, 0, 1) * 0.45) * v.attente * beat
  rgb = mix(rgb, BEACON, clamp(beam, 0, 1))

  return vec4(rgb, 1)
})

export default shader({ fps: 30, passes: [pace, view] })

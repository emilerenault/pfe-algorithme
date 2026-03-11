// 靈 © 2024-01-30 by Zaron Chen is licensed under CC BY-NC-SA 3.0. To view a copy of this license, visit https://creativecommons.org/licenses/by-nc-sa/3.0/
//
// Special thanks for inspiration:
//     https://gpfault.net/posts/webgl2-particles.txt.html

// --- Imports ---
// Shaders GLSL : update (transform feedback) et rendu (affichage)
import { UPDATE_VERT, UPDATE_FRAG } from "./shaderSource.js"
import { RENDER_VERT, RENDER_FRAG } from "./shaderSource.js"
// Olon : abstraction WebGL2 (buffers, VAO, transform feedback, uniforms)
import Olon, { Data } from "https://cdn.jsdelivr.net/npm/olon@0.0.0/src/Olon.js"
// Utilitaires mathématiques (random, floor, min)
import { random, floor, min } from "./tools.js"

// --- Constantes globales ---
const MAX_AMOUNT = 100000 // Nombre maximum de particules simultanées
const MIN_AGE = 3.5       // Durée de vie minimale d'une particule (en secondes)
const MAX_AGE = 7.0       // Durée de vie maximale d'une particule (en secondes)

// --- Presets ---
// Chaque preset définit les paramètres visuels du système de particules.
// Si plusieurs presets sont définis, ils s'interpolent en fonction du scroll.
const PRESETS = [
	{
		name: "Flux vers le nuage",
		birthRate: 0.50,
		clearAlpha: 0.07,
		blendMode: "normal",
		noiseScale: 6.0,
		noiseSpeed: 0.25,
		spawnScale: 0.60,
		forceStrength: 1.5,
		velocityDamping: 0.982,
		velocityGain: 1.8,
		pointScale: 1.8,
		tint: [0.85, 0.93, 1.0],
		alpha: 0.32,
	},
]

// Preset par défaut utilisé si PRESETS est vide
const DEFAULT_PRESET = {
	birthRate: 0.5,
	clearAlpha: 0.25,
	blendMode: "normal",
	noiseScale: 10.0,
	noiseSpeed: 0.5,
	spawnScale: 0.75,
	forceStrength: 3.0,
	velocityDamping: 0.95,
	velocityGain: 3.0,
	pointScale: 1.0,
	tint: [1.0, 1.0, 1.0],
	alpha: 1.0,
}

// --- Initialisation WebGL2 ---
// Création du contexte Olon (résolution interne du canvas)
const ol = Olon(1920, 1080)
ol.enableCanvas2D()

// Activation du blending alpha (transparence des particules)
ol.blend({ sfactor: ol.SRC_ALPHA, dfactor: ol.ONE_MINUS_SRC_ALPHA })
ol.enableBlend()

// --- Programmes GPU ---
// TFV : liste des varyings capturés par le transform feedback
const TFV = ["vPosition", "vAge", "vLife", "vVel"]
// Programme de mise à jour des particules (calcul position/vitesse/âge sur GPU)
const updateProgram = ol.createProgram(UPDATE_VERT, UPDATE_FRAG, TFV)
// Programme de rendu (affichage des particules sous forme de points)
const renderProgram = ol.createProgram(RENDER_VERT, RENDER_FRAG)

// --- Définition des attributs par particule ---
// Chaque particule stocke : position (x,y), âge, durée de vie, vitesse (x,y)
const aPosition = { name: "aPosition", unit: "f32", size: 2 }
const aAge      = { name: "aAge",      unit: "f32", size: 1 }
const aLife     = { name: "aLife",     unit: "f32", size: 1 }
const aVel      = { name: "aVel",      unit: "f32", size: 2 }
const attributes = [aPosition, aAge, aLife, aVel]

// --- Initialisation des données de particules ---
// Toutes les particules démarrent avec un âge > durée de vie → elles spawneront immédiatement
const particleData = []
for (let i = 0; i < MAX_AMOUNT; i++) {
	const life = random(MIN_AGE, MAX_AGE)
	particleData.push(0, 0)      // aPosition : position initiale hors champ
	particleData.push(life + 1)  // aAge : âge > life → force le spawn au 1er frame
	particleData.push(life)      // aLife : durée de vie aléatoire
	particleData.push(0, 0)      // aVel : vitesse initiale nulle
}
const initData = Data(particleData)

// --- Ping-pong buffers ---
// Deux buffers alternent à chaque frame : l'un est lu (read), l'autre est écrit (write).
// Cela évite les conflits de lecture/écriture sur le GPU.
const buffer0 = ol.createBuffer(initData, ol.STREAM_DRAW)
const buffer1 = ol.createBuffer(initData, ol.STREAM_DRAW)

// VAO (Vertex Array Object) : décrit comment lire les attributs depuis chaque buffer
const vao0 = ol.createVAO(updateProgram, {
	buffer: buffer0,
	stride: 4 * 6, // 6 floats × 4 octets par float
	attributes,
})
const vao1 = ol.createVAO(updateProgram, {
	buffer: buffer1,
	stride: 4 * 6,
	attributes,
})

const buffers = [buffer0, buffer1]
const vaos    = [vao0, vao1]
let [read, write]       = [0, 1]           // Indices du buffer actif
let [lastTime, bornAmount] = [0, 0]        // Temps du frame précédent, nb de particules vivantes
let activePreset   = DEFAULT_PRESET        // Preset courant (interpolé selon le scroll)
let scrollProgress = 0                     // Progression du scroll (0 → 1)
let faceMorph      = 0                     // Valeur lissée de faceMorph (forme du nuage)

// --- Fonctions mathématiques utilitaires ---

// Bloque une valeur entre 0 et 1
const clamp01 = (value) => {
	return Math.max(0, Math.min(1, value))
}

// Interpolation linéaire entre a et b selon t (0 = a, 1 = b)
const lerp = (a, b, t) => {
	return a + (b - a) * t
}

// Interpolation douce (courbe en S) entre edge0 et edge1
const smoothstep = (edge0, edge1, x) => {
	const t = clamp01((x - edge0) / (edge1 - edge0))
	return t * t * (3 - 2 * t)
}

// Interpolation linéaire sur un vecteur RGB (couleur)
const lerpVec3 = (a, b, t) => {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

// --- Gestion des presets ---

// Applique un preset directement (met à jour le mode de blending si besoin)
const applyPreset = (preset) => {
	activePreset = preset
	if (preset.blendMode === "additive") {
		// Mode additif : les particules s'additionnent (effet lumineux)
		ol.blend({ sfactor: ol.ONE, dfactor: ol.ONE })
	} else {
		// Mode normal : transparence alpha classique
		ol.blend({ sfactor: ol.SRC_ALPHA, dfactor: ol.ONE_MINUS_SRC_ALPHA })
	}
}

// Interpole tous les paramètres entre deux presets selon t (0 = a, 1 = b)
const mixPreset = (a, b, t) => {
	const mixed = {
		name: `${a.name} -> ${b.name}`,
		birthRate: lerp(a.birthRate, b.birthRate, t),
		clearAlpha: lerp(a.clearAlpha, b.clearAlpha, t),
		blendMode: t < 0.5 ? a.blendMode : b.blendMode,
		noiseScale: lerp(a.noiseScale, b.noiseScale, t),
		noiseSpeed: lerp(a.noiseSpeed, b.noiseSpeed, t),
		spawnScale: lerp(a.spawnScale, b.spawnScale, t),
		forceStrength: lerp(a.forceStrength, b.forceStrength, t),
		velocityDamping: lerp(a.velocityDamping, b.velocityDamping, t),
		velocityGain: lerp(a.velocityGain, b.velocityGain, t),
		pointScale: lerp(a.pointScale, b.pointScale, t),
		tint: lerpVec3(a.tint, b.tint, t),
		alpha: lerp(a.alpha, b.alpha, t),
	}
	applyPreset(mixed)
}

// --- Suivi du scroll ---
// Calcule la progression du scroll entre 0 (haut) et 1 (bas)
const updateScrollProgress = () => {
	const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
	scrollProgress = scrollableHeight > 0 ? clamp01(window.scrollY / scrollableHeight) : 0
}

window.addEventListener("scroll", updateScrollProgress, { passive: true })
window.addEventListener("resize", updateScrollProgress)
updateScrollProgress() // Initialisation au chargement

// Graine aléatoire envoyée au shader pour éviter des patterns répétitifs
ol.uniform("uRandom", [random() * 1024, random() * 1024])

// --- Boucle de rendu principale ---
// Appelée à chaque frame par Olon (≈ 60 fps)
ol.render(() => {
	// Calcul du temps et du delta (durée du frame précédent)
	const time = ol.frame / 60
	const timeDelta = time - lastTime
	lastTime = time

	// faceMorph contrôle la forme du nuage (0 = ouvert/diffus, 1 = dense/serré)
	// smoothstep crée une transition douce entre 0.22 et 0.95 du scroll
	// lerp(..., 0.08) lisse l'animation pour éviter les sauts brusques
	const faceMorphTarget = smoothstep(0.22, 0.95, scrollProgress)
	faceMorph = lerp(faceMorph, faceMorphTarget, 0.08)

	// Sélection et interpolation du preset selon la progression du scroll
	if (PRESETS.length > 1) {
		const scaled = scrollProgress * (PRESETS.length - 1)
		const fromIndex = Math.floor(scaled)
		const toIndex = Math.min(PRESETS.length - 1, fromIndex + 1)
		const t = scaled - fromIndex
		mixPreset(PRESETS[fromIndex], PRESETS[toIndex], t)
	} else if (PRESETS.length === 1) {
		applyPreset(PRESETS[0])
	} else {
		applyPreset(DEFAULT_PRESET)
	}

	// Calcul du nombre de particules actives selon le scroll
	// 10 % des particules sont actives dès le départ → nuage initial visible même sans scroll
	const scrollTarget = Math.floor(MAX_AMOUNT * Math.max(0.10, scrollProgress))
	const nextAmount = floor(bornAmount + activePreset.birthRate * 1000)
	bornAmount = Math.max(bornAmount, min(scrollTarget, nextAmount))

	// Effacement du canvas avec une transparence partielle → crée la traîne des particules
	ol.clearColor(0, 0, 0, activePreset.clearAlpha)
	ol.clearDepth()

	// --- Passe 1 : Update (transform feedback) ---
	// Calcule les nouvelles positions/vitesses/âges sur le GPU, sans passer par le CPU.
	// Lit depuis vaos[read] et écrit dans buffers[write].
	ol.use({ program: updateProgram }).run(() => {
		ol.transformFeedback(vaos[read], buffers[write], ol.POINTS, () => {
			ol.uniform("uTimeDelta",       timeDelta)
			ol.uniform("uTime",            time)
			ol.uniform("uNoiseScale",      activePreset.noiseScale)
			ol.uniform("uNoiseSpeed",      activePreset.noiseSpeed)
			ol.uniform("uSpawnScale",      activePreset.spawnScale)
			ol.uniform("uForceStrength",   activePreset.forceStrength)
			ol.uniform("uVelocityDamping", activePreset.velocityDamping)
			ol.uniform("uVelocityGain",    activePreset.velocityGain)
			ol.uniform("uFaceMorph",       faceMorph)
			ol.uniform("uMaxAmount",       MAX_AMOUNT)
			ol.points(0, bornAmount)
		})
	})

	// --- Passe 2 : Render ---
	// Affiche les particules mises à jour (stockées dans vaos[write]) sous forme de points.
	ol.use({
		program: renderProgram,
		VAO: vaos[write],
	}).run(() => {
		ol.uniform("uPointScale", activePreset.pointScale)
		ol.uniform("uTint",       activePreset.tint)
		ol.uniform("uAlpha",      activePreset.alpha)
		ol.points(0, bornAmount)
	})

	// Swap des buffers : write devient read au prochain frame (ping-pong)
	;[read, write] = [write, read]
})
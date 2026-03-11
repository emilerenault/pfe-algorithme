// 靈 © 2024-01-30 by Zaron Chen is licensed under CC BY-NC-SA 3.0. To view a copy of this license, visit https://creativecommons.org/licenses/by-nc-sa/3.0/
//
// Special thanks for inspiration:
//     https://gpfault.net/posts/webgl2-particles.txt.html

import { UPDATE_VERT, UPDATE_FRAG } from "./shaderSource.js"
import { RENDER_VERT, RENDER_FRAG } from "./shaderSource.js"
import Olon, { Data } from "https://cdn.jsdelivr.net/npm/olon@0.0.0/src/Olon.js"
import { random, floor, min } from "./tools.js"

const MAX_AMOUNT = 100000
const MIN_AGE = 3.5
const MAX_AGE = 7.0

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

const ol = Olon(1920, 1080)
ol.enableCanvas2D()

ol.blend({ sfactor: ol.SRC_ALPHA, dfactor: ol.ONE_MINUS_SRC_ALPHA })
ol.enableBlend()

const TFV = ["vPosition", "vAge", "vLife", "vVel"]
const updateProgram = ol.createProgram(UPDATE_VERT, UPDATE_FRAG, TFV)
const renderProgram = ol.createProgram(RENDER_VERT, RENDER_FRAG)

const aPosition = { name: "aPosition", unit: "f32", size: 2 }
const aAge = { name: "aAge", unit: "f32", size: 1 }
const aLife = { name: "aLife", unit: "f32", size: 1 }
const aVel = { name: "aVel", unit: "f32", size: 2 }
const attributes = [aPosition, aAge, aLife, aVel]

const particleData = []
for (let i = 0; i < MAX_AMOUNT; i++) {
	const life = random(MIN_AGE, MAX_AGE)
	particleData.push(0, 0) // aPosition
	particleData.push(life + 1) // aAge
	particleData.push(life) // aLife
	particleData.push(0, 0) // aVel
}
const initData = Data(particleData)

const buffer0 = ol.createBuffer(initData, ol.STREAM_DRAW)
const buffer1 = ol.createBuffer(initData, ol.STREAM_DRAW)

const vao0 = ol.createVAO(updateProgram, {
	buffer: buffer0,
	stride: 4 * 6,
	attributes,
})
const vao1 = ol.createVAO(updateProgram, {
	buffer: buffer1,
	stride: 4 * 6,
	attributes,
})

const buffers = [buffer0, buffer1]
const vaos = [vao0, vao1]
let [read, write] = [0, 1]
let [lastTime, bornAmount] = [0, 0]
let activePreset = DEFAULT_PRESET
let scrollProgress = 0
let faceMorph = 0

const clamp01 = (value) => {
	return Math.max(0, Math.min(1, value))
}

const lerp = (a, b, t) => {
	return a + (b - a) * t
}

const smoothstep = (edge0, edge1, x) => {
	const t = clamp01((x - edge0) / (edge1 - edge0))
	return t * t * (3 - 2 * t)
}

const lerpVec3 = (a, b, t) => {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

const applyPreset = (preset) => {
	activePreset = preset
	if (preset.blendMode === "additive") {
		ol.blend({ sfactor: ol.ONE, dfactor: ol.ONE })
	} else {
		ol.blend({ sfactor: ol.SRC_ALPHA, dfactor: ol.ONE_MINUS_SRC_ALPHA })
	}
}

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

const updateScrollProgress = () => {
	const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
	scrollProgress = scrollableHeight > 0 ? clamp01(window.scrollY / scrollableHeight) : 0
}

window.addEventListener("scroll", updateScrollProgress, { passive: true })
window.addEventListener("resize", updateScrollProgress)
updateScrollProgress()

ol.uniform("uRandom", [random() * 1024, random() * 1024])

ol.render(() => {
	const time = ol.frame / 60
	const timeDelta = time - lastTime
	lastTime = time
	const faceMorphTarget = smoothstep(0.22, 0.95, scrollProgress)
	faceMorph = lerp(faceMorph, faceMorphTarget, 0.08)

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

	// 10 % des particules actives dès le départ → nuage initial visible
	const scrollTarget = Math.floor(MAX_AMOUNT * Math.max(0.10, scrollProgress))
	const nextAmount = floor(bornAmount + activePreset.birthRate * 1000)
	bornAmount = Math.max(bornAmount, min(scrollTarget, nextAmount))

	ol.clearColor(0, 0, 0, activePreset.clearAlpha)
	ol.clearDepth()

	ol.use({ program: updateProgram }).run(() => {
		ol.transformFeedback(vaos[read], buffers[write], ol.POINTS, () => {
			ol.uniform("uTimeDelta", timeDelta)
			ol.uniform("uTime", time)
			ol.uniform("uNoiseScale", activePreset.noiseScale)
			ol.uniform("uNoiseSpeed", activePreset.noiseSpeed)
			ol.uniform("uSpawnScale", activePreset.spawnScale)
			ol.uniform("uForceStrength", activePreset.forceStrength)
			ol.uniform("uVelocityDamping", activePreset.velocityDamping)
			ol.uniform("uVelocityGain", activePreset.velocityGain)
			ol.uniform("uFaceMorph", faceMorph)
			ol.uniform("uMaxAmount", MAX_AMOUNT)
			ol.points(0, bornAmount)
		})
	})

	ol.use({
		program: renderProgram,
		VAO: vaos[write],
	}).run(() => {
		ol.uniform("uPointScale", activePreset.pointScale)
		ol.uniform("uTint", activePreset.tint)
		ol.uniform("uAlpha", activePreset.alpha)
		ol.points(0, bornAmount)
	})

	// swap
	;[read, write] = [write, read]
})
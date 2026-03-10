import * as Shox from "https://cdn.jsdelivr.net/npm/shox@1.1.0/src/Shox.js"

export const UPDATE_VERT = `
	precision mediump float;

	uniform float uTimeDelta;
	uniform float uTime;
	uniform vec2 uRandom;
	uniform float uNoiseScale;
	uniform float uNoiseSpeed;
	uniform float uSpawnScale;
	uniform float uForceStrength;
	uniform float uVelocityDamping;
	uniform float uVelocityGain;
	uniform float uFaceMorph;
	uniform float uMaxAmount;

	in vec2 aPosition;
	in float aAge;
	in float aLife;
	in vec2 aVel;

	out vec2 vPosition;
	out float vAge;
	out float vLife;
	out vec2 vVel;

	${Shox.noiseMath}
	${Shox.snoise3D}
	${Shox.hash}

	const float PI = 3.14159265359;

	vec2 linePoint(vec2 a, vec2 b, float t) {
		return mix(a, b, t);
	}

	vec2 letterE(float t) {
		if (t < 0.4) return linePoint(vec2(0.0, -0.35), vec2(0.0, 0.35), t / 0.4);
		if (t < 0.62) return linePoint(vec2(0.0, 0.35), vec2(0.23, 0.35), (t - 0.4) / 0.22);
		if (t < 0.82) return linePoint(vec2(0.0, 0.0), vec2(0.18, 0.0), (t - 0.62) / 0.20);
		return linePoint(vec2(0.0, -0.35), vec2(0.23, -0.35), (t - 0.82) / 0.18);
	}

	vec2 letterM(float t) {
		if (t < 0.26) return linePoint(vec2(0.0, -0.35), vec2(0.0, 0.35), t / 0.26);
		if (t < 0.52) return linePoint(vec2(0.0, 0.35), vec2(0.14, -0.05), (t - 0.26) / 0.26);
		if (t < 0.78) return linePoint(vec2(0.14, -0.05), vec2(0.28, 0.35), (t - 0.52) / 0.26);
		return linePoint(vec2(0.28, 0.35), vec2(0.28, -0.35), (t - 0.78) / 0.22);
	}

	vec2 letterI(float t) {
		if (t < 0.24) return linePoint(vec2(0.0, 0.35), vec2(0.28, 0.35), t / 0.24);
		if (t < 0.76) return linePoint(vec2(0.14, 0.35), vec2(0.14, -0.35), (t - 0.24) / 0.52);
		return linePoint(vec2(0.0, -0.35), vec2(0.28, -0.35), (t - 0.76) / 0.24);
	}

	vec2 letterL(float t) {
		if (t < 0.66) return linePoint(vec2(0.0, 0.35), vec2(0.0, -0.35), t / 0.66);
		return linePoint(vec2(0.0, -0.35), vec2(0.26, -0.35), (t - 0.66) / 0.34);
	}

	vec2 emilePoint(float idNorm) {
		float idx = floor(idNorm * 5.0);
		float local = fract(idNorm * 5.0);
		vec2 glyph;

		if (idx < 0.5) glyph = letterE(local);
		else if (idx < 1.5) glyph = letterM(local);
		else if (idx < 2.5) glyph = letterI(local);
		else if (idx < 3.5) glyph = letterL(local);
		else glyph = letterE(local);

		float letterWidth = 0.28;
		float gap = 0.08;
		float advance = letterWidth + gap;
		float startX = -0.5 * (5.0 * letterWidth + 4.0 * gap);
		float offsetX = startX + idx * advance;

		vec2 jitter = hash22(vec2(idNorm * 53.0, idNorm * 97.0)) - 0.5;
		glyph += vec2(jitter.x * 0.018, jitter.y * 0.018);

		return vec2(offsetX + glyph.x, glyph.y * 0.95);
	}

	void main() {
		vec2 noise = vec2(
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+200.), uTime*uNoiseSpeed)),
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+100.), uTime*uNoiseSpeed))
		);
		float idNorm = fract(float(gl_VertexID) / max(1.0, uMaxAmount));
		vec2 targetWord = emilePoint(idNorm);

		if (aAge >= aLife) {
			ivec2 coord = ivec2(gl_VertexID%512, gl_VertexID/512);
			vec2 rand = hash22(vec2(coord));
			float posX = snoise(vec3(rand+vec2(uRandom.x), -uTime*.1+noise.x*.1));
			float posY = snoise(vec3(rand-vec2(uRandom.y),  uTime*.1+noise.y*.1));
			vec2 abstractSpawn = uSpawnScale*vec2(posX, posY);
			vPosition = mix(abstractSpawn, targetWord, uFaceMorph);
			vAge = 0.;
			vLife = aLife;
			vVel = mix(vPosition, vec2(0.), uFaceMorph*0.85);
		} else {
			vec2 force = uForceStrength*(2.*noise.rg-1.);
			vec2 toFace = targetWord-aPosition;
			vec2 faceForce = toFace*(0.6+8.0*uFaceMorph);
			float flowKeep = 1.0-uFaceMorph;
			float damp = mix(uVelocityDamping, 0.88, uFaceMorph);
			vPosition = aPosition+aVel*uTimeDelta;
			vAge = aAge+uTimeDelta;
			vLife = aLife;
			vVel = damp*aVel+force*uTimeDelta*uVelocityGain*flowKeep+faceForce*uTimeDelta;
		}
	}
`

export const UPDATE_FRAG = `
	precision mediump float;
	in float vAge;
	void main() { discard; }
`

export const RENDER_VERT = `
	precision mediump float;
	uniform float uPointScale;

	in vec4 aPosition;
	in float aAge;
	in float aLife;

	out vec4 vPosition;
	out float vAge;
	out float vLife;

	void main() {
		vPosition = aPosition;
		vAge = aAge;
		vLife = aLife;
		gl_PointSize = max(0.1, uPointScale*(1.-aAge/aLife));
		gl_Position = aPosition;
	}
`

export const RENDER_FRAG = `
	precision mediump float;
	uniform vec3 uTint;
	uniform float uAlpha;

	in float vAge;
	in float vLife;

	out vec4 fragColor;
	void main() {
		float lifeFade = max(0., 1.-vAge/vLife);
		fragColor = vec4(uTint*lifeFade, uAlpha*lifeFade);
	}
`
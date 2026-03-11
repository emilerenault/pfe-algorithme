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

	void main() {
		vec2 noise = vec2(
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+200.), uTime*uNoiseSpeed)),
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+100.), uTime*uNoiseSpeed))
		);
		float particleId = float(gl_VertexID);

		if (aAge >= aLife) {
			// Spawn depuis les bords — dérive continue pour éviter les couloirs et les vagues
			ivec2 coord = ivec2(gl_VertexID % 512, gl_VertexID / 512);
			vec2 rand  = hash22(vec2(coord));
			vec2 rand2 = hash22(vec2(coord) + vec2(31.7, 57.3));
			float side = step(0.5, rand.x);
			float xOff = mix(-1.65, 1.65, side);
			float driftA = snoise(vec3(particleId * 0.0035, rand.x * 5.0, uTime * 0.14));
			float driftB = snoise(vec3(particleId * 0.0057 + 19.0, rand.y * 7.0, uTime * 0.09));
			float yBase = rand2.x * 2.0 - 1.0;
			float yOff = clamp(yBase * 0.76 + driftA * 0.16 + driftB * 0.08, -1.0, 1.0);
			vPosition = vec2(xOff, yOff * 0.88);
			vAge = 0.;
			vLife = aLife;
			float impulse = mix(0.42, 0.24, uFaceMorph);
			float ySpread = mix(0.12, 0.18, uFaceMorph);
			vVel = vec2(mix(impulse, -impulse, side), (rand2.y - 0.5) * ySpread + driftB * 0.03);
		} else {
			vec2 force = uForceStrength * (2.0 * noise.rg - 1.0);
			vec2 toCenter = -aPosition;
			float dist = length(toCenter);

			float cloudRadius = mix(0.30, 0.18, uFaceMorph);

			// outsideCloud = 1 hors du nuage, 0 à l'intérieur
			// insideCloud  = 1 à l'intérieur, 0 à l'extérieur
			float outsideCloud = smoothstep(0.0, cloudRadius, dist);
			float insideCloud  = 1.0 - outsideCloud;

			// Hors du nuage : attraction vers le centre
			float attractStrength = mix(1.0, 4.2, uFaceMorph);
			vec2 convergenceForce = toCenter * attractStrength * outsideCloud;

			// Amortissement : fort dans le nuage pour tuer le momentum directionnel
			float dampInside  = mix(0.82, 0.91, uFaceMorph);
			float dampOutside = 0.968;
			float damp = mix(dampOutside, dampInside, insideCloud);

			vec2 centerDir = dist > 0.0001 ? toCenter / dist : vec2(0.0);
			vec2 orthoDir = vec2(-centerDir.y, centerDir.x);
			float laneNoise = snoise(vec3(particleId * 0.0021 + 13.0, dist * 4.0, uTime * 0.28));
			vec2 swirlForce = orthoDir * laneNoise * 0.028 * outsideCloud;

			// Bruit de Perlin :
			//   dans le nuage  → fort, anime la forme organique
			//   hors du nuage  → légère turbulence pour l'aspect fumée/fluide
			float flowInside  = mix(0.45, 2.2, uFaceMorph);
			float flowOutside = mix(0.14, 0.18, uFaceMorph);
			float flowKeep = mix(flowOutside, flowInside, insideCloud);
			vec2 noiseForce = force * uTimeDelta * uVelocityGain * flowKeep;

			vPosition = aPosition + aVel * uTimeDelta;
			vAge = aAge + uTimeDelta;
			vLife = aLife;
			vVel = damp * aVel + noiseForce + swirlForce + convergenceForce * uTimeDelta;
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
// Import de la bibliothèque Shox : fonctions GLSL partagées
// (bruit de Perlin 3D, hash, fonctions mathématiques utilitaires)
import * as Shox from "https://cdn.jsdelivr.net/npm/shox@1.1.0/src/Shox.js"

// =============================================================================
// UPDATE_VERT — Shader de mise à jour (Transform Feedback)
// =============================================================================
// Exécuté sur GPU à chaque frame pour chaque particule.
// Calcule la nouvelle position, vitesse et âge sans passer par le CPU.
// Les résultats sont écrits directement dans un buffer GPU (transform feedback).
export const UPDATE_VERT = `
	precision mediump float;

	// --- Uniforms (valeurs envoyées depuis sketch.js à chaque frame) ---
	uniform float uTimeDelta;      // Durée du frame précédent (en secondes)
	uniform float uTime;           // Temps écoulé depuis le début (en secondes)
	uniform vec2  uRandom;         // Graine aléatoire pour éviter les patterns répétitifs
	uniform float uNoiseScale;     // Échelle spatiale du champ de Perlin
	uniform float uNoiseSpeed;     // Vitesse d'évolution temporelle du bruit
	uniform float uSpawnScale;     // Échelle de la zone de spawn
	uniform float uForceStrength;  // Intensité maximale de la force de Perlin
	uniform float uVelocityDamping;// Facteur de friction (< 1 = ralentissement)
	uniform float uVelocityGain;   // Amplification de la force de Perlin
	uniform float uFaceMorph;      // Progression de la forme du nuage (0 = ouvert, 1 = dense)
	uniform float uMaxAmount;      // Nombre total de particules

	// --- Attributs d'entrée (lus depuis le buffer GPU «re») ---
	in vec2  aPosition; // Position courante (x, y) en espace normalisé [-1, 1]
	in float aAge;      // Âge actuel de la particule (en secondes)
	in float aLife;     // Durée de vie totale (aléatoire entre MIN_AGE et MAX_AGE)
	in vec2  aVel;      // Vitesse courante (vecteur 2D)

	// --- Varyings de sortie (capturés par le transform feedback dans le buffer «write») ---
	out vec2  vPosition;
	out float vAge;
	out float vLife;
	out vec2  vVel;

	// Injection des fonctions GLSL de Shox
	${Shox.noiseMath}  // Fonctions math utilisées par le bruit
	${Shox.snoise3D}   // Bruit de Perlin 3D fluide (Simplex noise)
	${Shox.hash}       // Fonctions de hachage pseudo-aléatoires

	void main() {
		// Calcul du champ de bruit de Perlin en 2D à partir de la position courante
		// Les deux composantes donnent une force vectorielle 2D
		vec2 noise = vec2(
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+200.), uTime*uNoiseSpeed)),
			.5+.5*snoise(vec3(vec2(aPosition*uNoiseScale+100.), uTime*uNoiseSpeed))
		);
		float particleId = float(gl_VertexID); // Identifiant unique de la particule

		if (aAge >= aLife) {
			// --- Respawn : la particule est morte, on la fait renaître ---
			// Spawn depuis les bords gauche ou droit à une position aléatoire en Y.
			// Une dérive temporelle évite les couloirs et les vagues répétitives.
			ivec2 coord = ivec2(gl_VertexID % 512, gl_VertexID / 512);
			vec2 rand  = hash22(vec2(coord));
			vec2 rand2 = hash22(vec2(coord) + vec2(31.7, 57.3));
			float side = step(0.5, rand.x);            // 0 = gauche, 1 = droite
			float xOff = mix(-1.65, 1.65, side);       // Position X hors écran
			// Dérive temporelle en Y pour casser les patterns
			float driftA = snoise(vec3(particleId * 0.0035, rand.x * 5.0, uTime * 0.14));
			float driftB = snoise(vec3(particleId * 0.0057 + 19.0, rand.y * 7.0, uTime * 0.09));
			float yBase = rand2.x * 2.0 - 1.0;
			float yOff = clamp(yBase * 0.76 + driftA * 0.16 + driftB * 0.08, -1.0, 1.0);
			vPosition = vec2(xOff, yOff * 0.88);
			vAge  = 0.;
			vLife = aLife;
			// Impulsion initiale vers le centre (réduite quand le nuage est dense)
			float impulse = mix(0.42, 0.24, uFaceMorph);
			float ySpread = mix(0.12, 0.18, uFaceMorph);
			vVel = vec2(mix(impulse, -impulse, side), (rand2.y - 0.5) * ySpread + driftB * 0.03);
		} else {
			// --- Mise à jour : la particule est vivante ---

			vec2 force = uForceStrength * (2.0 * noise.rg - 1.0); // Force de Perlin centrée sur zéro
			vec2 toCenter = -aPosition;   // Vecteur pointant vers le centre (0, 0)
			float dist = length(toCenter); // Distance au centre

			// Rayon du nuage : se rétrécit avec le scroll (nuage plus dense en fin de page)
			float cloudRadius = mix(0.30, 0.18, uFaceMorph);

			// outsideCloud = 1 hors du nuage, 0 à l'intérieur (transition douce)
			// insideCloud  = 1 à l'intérieur, 0 hors du nuage
			float outsideCloud = smoothstep(0.0, cloudRadius, dist);
			float insideCloud  = 1.0 - outsideCloud;

			// Force d'attraction vers le centre (hors du nuage uniquement)
			float attractStrength = mix(1.0, 4.2, uFaceMorph);
			vec2 convergenceForce = toCenter * attractStrength * outsideCloud;

			// Amortissement différencié : fort dans le nuage pour tuer le momentum du flux entrant
			float dampInside  = mix(0.82, 0.91, uFaceMorph);
			float dampOutside = 0.968;
			float damp = mix(dampOutside, dampInside, insideCloud);

			// Force de tourbillon tangentielle (hors nuage) pour éviter les trajectoires parallèles
			vec2 centerDir = dist > 0.0001 ? toCenter / dist : vec2(0.0);
			vec2 orthoDir = vec2(-centerDir.y, centerDir.x); // Vecteur perpendiculaire
			float laneNoise = snoise(vec3(particleId * 0.0021 + 13.0, dist * 4.0, uTime * 0.28));
			vec2 swirlForce = orthoDir * laneNoise * 0.028 * outsideCloud;

			// Intensité du bruit de Perlin selon la zone :
			// - Dans le nuage : fort → anime la forme organique de manière autonome
			// - Hors du nuage : faible → légère turbulence (aspect fumée/fluide)
			float flowInside  = mix(0.45, 2.2,  uFaceMorph);
			float flowOutside = mix(0.14, 0.18, uFaceMorph);
			float flowKeep = mix(flowOutside, flowInside, insideCloud);
			vec2 noiseForce = force * uTimeDelta * uVelocityGain * flowKeep;

			// Intégration Euler : nouvelle position = ancienne + vitesse * delta
			vPosition = aPosition + aVel * uTimeDelta;
			vAge  = aAge + uTimeDelta;
			vLife = aLife;
			// Nouvelle vitesse : amortissement + forces combinées
			vVel = damp * aVel + noiseForce + swirlForce + convergenceForce * uTimeDelta;
		}
	}
`

// =============================================================================
// UPDATE_FRAG — Fragment shader de mise à jour
// =============================================================================
// Ce shader est requis par WebGL même en mode transform feedback,
// mais il ne produit aucun pixel : tout passe par discard.
export const UPDATE_FRAG = `
	precision mediump float;
	in float vAge;
	void main() { discard; } // Aucun rendu, seul le transform feedback compte
`

// =============================================================================
// RENDER_VERT — Vertex shader de rendu
// =============================================================================
// Positionne chaque particule à l'écran et calcule sa taille selon son âge.
export const RENDER_VERT = `
	precision mediump float;
	uniform float uPointScale; // Taille de base des particules

	in vec4  aPosition; // Position en espace normalisé [-1, 1]
	in float aAge;      // Âge actuel (en secondes)
	in float aLife;     // Durée de vie totale (en secondes)

	out vec4  vPosition;
	out float vAge;
	out float vLife;

	void main() {
		vPosition = aPosition;
		vAge  = aAge;
		vLife = aLife;
		// La particule rétrécit progressivement jusqu'à sa mort (fade out en taille)
		gl_PointSize = max(0.1, uPointScale*(1.-aAge/aLife));
		gl_Position  = aPosition;
	}
`

// =============================================================================
// RENDER_FRAG — Fragment shader de rendu
// =============================================================================
// Colorise chaque particule avec un fondu vers la transparence au fil de sa vie.
export const RENDER_FRAG = `
	precision mediump float;
	uniform vec3  uTint;   // Couleur RGB des particules
	uniform float uAlpha;  // Opacité globale

	in float vAge;
	in float vLife;

	out vec4 fragColor;
	void main() {
		// lifeFade : 1 à la naissance, 0 à la mort → fondu progressif
		float lifeFade = max(0., 1.-vAge/vLife);
		fragColor = vec4(uTint*lifeFade, uAlpha*lifeFade);
	}
`
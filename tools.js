// Fonctions utilitaires mathématiques utilisées dans sketch.js

// Retourne un nombre aléatoire entre min (inclus) et max (exclus)
// Par défaut : entre 0 et 1
export const random = (min = 0, max = 1) => {
	return Math.random() * (max - min) + min
}

// Retourne la partie entière inférieure d'un nombre
export const floor = (value) => {
	return Math.floor(value)
}

// Retourne le plus petit des deux nombres
export const min = (value1, value2) => {
	return Math.min(value1, value2)
}

export const random = (min = 0, max = 1) => {
	return Math.random() * (max - min) + min
}

export const floor = (value) => {
	return Math.floor(value)
}

export const min = (value1, value2) => {
	return Math.min(value1, value2)
}

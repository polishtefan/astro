export const SIGN_GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
// Названия знаков живут в текстах интерфейса (src/lib/copy.ts):
// здесь только язык-независимое — глифы и математика углов.

/** Нормализация угла в [0, 360). */
export const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Кратчайшая разница двух долгот, [0, 180]. */
export function angularDistance(a: number, b: number): number {
	const d = Math.abs(norm360(a - b));
	return d > 180 ? 360 - d : d;
}

export interface ZodiacPosition {
	signIndex: number;
	signGlyph: string;
	/** Градус внутри знака, 0–29. */
	degree: number;
	minute: number;
}

export function toZodiac(longitude: number): ZodiacPosition {
	const l = norm360(longitude);
	const signIndex = Math.floor(l / 30);
	const withinSign = l - signIndex * 30;
	const degree = Math.floor(withinSign);
	// округление минут вверх до 60 сдвинуло бы градус — прижимаем к 59
	const minute = Math.min(59, Math.floor((withinSign - degree) * 60));
	return {
		signIndex,
		signGlyph: SIGN_GLYPHS[signIndex],
		degree,
		minute
	};
}

export type Element = 'fire' | 'earth' | 'air' | 'water';

/**
 * Стихия знака. Порядок знаков в зодиаке циклически повторяет
 * огонь → земля → воздух → вода, поэтому индекс по модулю 4 и есть стихия.
 */
export const ELEMENTS: readonly Element[] = ['fire', 'earth', 'air', 'water'];

export function elementOf(signIndex: number): Element {
	return ELEMENTS[signIndex % 4];
}

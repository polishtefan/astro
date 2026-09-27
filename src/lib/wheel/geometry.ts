import { norm360 } from '$lib/astro/format';

/**
 * Геометрия колеса. Центр (320, 320), все радиусы отсчитываются от него.
 *
 * Холст шире самого колеса: за кольцом знаков стоят подписи домов, поэтому
 * viewBox начинается в отрицательных координатах. По горизонтали запас больше —
 * там подписи уходят вбок целым словом.
 */
export const WHEEL = {
	cx: 320,
	cy: 320,
	viewBox: '-40 -18 720 676',
	/** Кольцо знаков. */
	signOuter: 300,
	signInner: 252,
	signMid: 276,
	/** Кольца, на которых стоят глифы планет. */
	transit: 232,
	natal: 208,
	/** Точки истинного градуса транзитов — на внутреннем крае кольца знаков. */
	transitDot: 252,
	/**
	 * Круг аспектов — он же круг, на котором лежат точки истинного градуса
	 * натальных планет. Хорда аспекта начинается ровно в точке планеты, поэтому
	 * одна метка работает на два смысла.
	 */
	aspect: 190,
	/** Внешний конец линии куспида — чуть за кольцом знаков. */
	houseLineOuter: 307,
	/** Подписи домов снаружи колеса. */
	cuspLabel: 314,
	/** Минимальный угловой зазор при разведении глифов. */
	declutterGap: 10
} as const;

export type Point = [x: number, y: number];

/**
 * Зодиакальная долгота → точка на экране.
 *
 * ASC слева (9 часов), долгота растёт против часовой стрелки:
 *   screenAngle = 180 − (lon − ascendant)
 */
export function polar(longitude: number, radius: number, ascendant: number): Point {
	const angle = ((180 - (longitude - ascendant)) * Math.PI) / 180;
	return [WHEEL.cx + radius * Math.cos(angle), WHEEL.cy + radius * Math.sin(angle)];
}

/**
 * Дуга от одной долготы до другой.
 *
 * Долгота растёт против часовой стрелки, то есть экранный угол убывает —
 * поэтому sweep-flag нулевой. Сектор знака ровно 30°, large-arc не нужен.
 */
export function arcPath(
	fromLongitude: number,
	toLongitude: number,
	radius: number,
	ascendant: number
): string {
	const [x1, y1] = polar(fromLongitude, radius, ascendant);
	const [x2, y2] = polar(toLongitude, radius, ascendant);
	return `M ${x1} ${y1} A ${radius} ${radius} 0 0 0 ${x2} ${y2}`;
}

/**
 * Де-коллизия глифов на кольце.
 *
 * Планеты в соединении накладываются друг на друга, поэтому раздвигаем их до
 * минимального углового зазора: проходим по кругу и расталкиваем соседей на
 * половину нехватки каждый, пока всё не разойдётся. Истинный градус при этом
 * не меняется — его показывает точка на круге.
 *
 * @returns смещённые долготы в том же порядке, что и вход
 */
export function declutter(longitudes: number[], minGap = 8): number[] {
	if (longitudes.length < 2) return [...longitudes];

	const ring = longitudes
		.map((lon, index) => ({ index, plotted: norm360(lon) }))
		.sort((a, b) => a.plotted - b.plotted);

	for (let pass = 0; pass < 40; pass++) {
		let moved = false;
		for (let k = 0; k < ring.length; k++) {
			const a = ring[k];
			const b = ring[(k + 1) % ring.length];
			const gap = norm360(b.plotted - a.plotted);
			if (gap < minGap) {
				const push = (minGap - gap) / 2;
				a.plotted = norm360(a.plotted - push);
				b.plotted = norm360(b.plotted + push);
				moved = true;
			}
		}
		if (!moved) break;
	}

	const out = new Array<number>(longitudes.length);
	for (const item of ring) out[item.index] = item.plotted;
	return out;
}

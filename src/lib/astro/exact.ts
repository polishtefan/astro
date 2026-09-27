/**
 * Точные транзиты: когда транзитная планета образует точный аспект к точке
 * натальной карты.
 *
 * Для пары «транзитная планета → натальная точка» и аспекта с углом A берём
 * функцию
 *
 *   f(t) = (λ(t) − φ), приведённая к (−180°, 180°],   где φ = натал + A
 *
 * λ(t) — долгота транзитной планеты. Аспект точный там, где f проходит через
 * ноль. Поиск в два шага:
 *
 * 1. Грубо: шагаем по окну с шагом в сутки и ловим смену знака f. Быстрее всех
 *    в списке Меркурий — до ~2.2° в сутки, так что переход между двумя
 *    соседними отсчётами не проскочит. Луна исключена: её аспекты повторяются
 *    каждый месяц и утопили бы список.
 * 2. Точно: бисекцией сужаем найденный суточный интервал. 20 делений дают
 *    1 сутки / 2²⁰ ≈ 0.08 секунды — точнее, чем имеет смысл показывать.
 *
 * Модуль намеренно не знает, откуда берутся долготы: на вход приходит функция
 * longitudeAt. Поэтому его можно проверять в Node на тех же эфемеридах, что и
 * в браузере, без SvelteKit и загрузчика wasm.
 */

import type { AspectDef } from './aspects';
import type { BodyId } from './types';

/** Долгота и скорость тела в момент jd (юлианский день UT). */
export type LongitudeAt = (jd: number, sweId: number) => { longitude: number; speed: number };

export interface TransitingBody {
	id: BodyId;
	sweId: number;
}

/** Натальная точка, к которой ищем аспекты: планета или угол карты. */
export interface ExactTarget {
	id: string;
	longitude: number;
}

export interface ExactHit {
	transitId: BodyId;
	targetId: string;
	aspectId: string;
	/** Момент точного аспекта, юлианский день UT. */
	jd: number;
	date: Date;
	/** Транзитная планета в этот момент ретроградна — это «обратный» проход. */
	retrograde: boolean;
}

export interface ExactSearch {
	transiting: readonly TransitingBody[];
	targets: readonly ExactTarget[];
	aspects: readonly AspectDef[];
	fromJd: number;
	toJd: number;
}

const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;

/**
 * Юлианский день ↔ Date напрямую, без обращения к эфемеридам.
 * Разница между UT1 и UTC меньше секунды — для дат транзитов это не важно.
 */
export const dateToJd = (date: Date) => date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
export const jdToDate = (jd: number) => new Date((jd - UNIX_EPOCH_JD) * MS_PER_DAY);

/** Приведение угла к (−180, 180] — знак показывает, «до» или «после» точки. */
function signedAngle(deg: number): number {
	const d = ((deg % 360) + 360) % 360;
	return d > 180 ? d - 360 : d;
}

const BISECTION_STEPS = 20;

export function findExactAspects(longitudeAt: LongitudeAt, search: ExactSearch): ExactHit[] {
	const { transiting, targets, aspects, fromJd, toJd } = search;
	const hits: ExactHit[] = [];

	// точки φ, в которых аспект точный: для 0° и 180° одна, для остальных две —
	// секстиль, квадрат и трин бывают и «до», и «после» натальной точки
	const points = targets.flatMap((target) =>
		aspects.flatMap((aspect) => {
			const sides = aspect.angle === 0 || aspect.angle === 180 ? [aspect.angle] : [aspect.angle, -aspect.angle];
			return sides.map((offset) => ({ target, aspect, phi: target.longitude + offset }));
		})
	);

	for (const body of transiting) {
		// грубая сетка: долготы на каждые сутки окна считаем один раз и
		// переиспользуем для всех натальных точек
		const days = Math.ceil(toJd - fromJd);
		const samples: number[] = [];
		for (let i = 0; i <= days; i++) samples.push(longitudeAt(fromJd + i, body.sweId).longitude);

		for (const { target, aspect, phi } of points) {
			for (let i = 0; i < days; i++) {
				const f0 = signedAngle(samples[i] - phi);
				const f1 = signedAngle(samples[i + 1] - phi);

				// смена знака — но не скачок через ±180°: там f меняет знак, а
				// планета находится на противоположной стороне круга
				const crosses = (f0 < 0 && f1 >= 0) || (f0 > 0 && f1 <= 0);
				if (!crosses || Math.abs(f0) > 90 || Math.abs(f1) > 90) continue;

				let lo = fromJd + i;
				let hi = lo + 1;
				let fLo = f0;
				for (let step = 0; step < BISECTION_STEPS; step++) {
					const mid = (lo + hi) / 2;
					const fMid = signedAngle(longitudeAt(mid, body.sweId).longitude - phi);
					if ((fLo < 0 && fMid >= 0) || (fLo > 0 && fMid <= 0)) {
						hi = mid;
					} else {
						lo = mid;
						fLo = fMid;
					}
				}

				const jd = (lo + hi) / 2;
				hits.push({
					transitId: body.id,
					targetId: target.id,
					aspectId: aspect.id,
					jd,
					date: jdToDate(jd),
					retrograde: longitudeAt(jd, body.sweId).speed < 0
				});
			}
		}
	}

	return hits.sort((a, b) => a.jd - b.jd);
}

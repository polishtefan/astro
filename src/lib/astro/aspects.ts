import { angularDistance } from './format';

export type AspectQuality = 'neutral' | 'soft' | 'hard';

export interface AspectDef {
	id: string;
	label: string;
	glyph: string;
	angle: number;
	orb: number;
	quality: AspectQuality;
}

/**
 * Мажорные аспекты. orb здесь — базовый орб для двух планет в натале; поправки
 * на светила, углы и транзиты — в natalOrb / transitOrb ниже.
 * Соединение линией не рисуется — только в списке.
 */
export const ASPECT_DEFS: readonly AspectDef[] = [
	{ id: 'conjunction', label: 'Conjunction', glyph: '☌', angle: 0, orb: 8, quality: 'neutral' },
	{ id: 'sextile', label: 'Sextile', glyph: '⚹', angle: 60, orb: 4, quality: 'soft' },
	{ id: 'square', label: 'Square', glyph: '□', angle: 90, orb: 6, quality: 'hard' },
	{ id: 'trine', label: 'Trine', glyph: '△', angle: 120, orb: 6, quality: 'soft' },
	{ id: 'opposition', label: 'Opposition', glyph: '☍', angle: 180, orb: 8, quality: 'hard' }
];

/**
 * Точка, участвующая в аспекте: планета или угол карты (ASC, MC). Для аспекта
 * нужны только имя и долгота, поэтому BodyPosition сюда подходит как есть, а
 * углу хватает двух полей — не приходится выдумывать ему скорость и дом.
 */
export interface AspectPoint {
	id: string;
	longitude: number;
}

/** Углы карты в порядке обхода колеса от ASC — так же стоят подписи As/Ic/Ds/Mc. */
export const ANGLE_IDS = ['asc', 'ic', 'dsc', 'mc'] as const;
export type AngleId = (typeof ANGLE_IDS)[number];

const isAngle = (p: AspectPoint) => (ANGLE_IDS as readonly string[]).includes(p.id);
const isLuminary = (p: AspectPoint) => p.id === 'sun' || p.id === 'moon';

/** Орб аспекта для конкретной пары точек. */
export type OrbRule = (def: AspectDef, a: AspectPoint, b: AspectPoint) => number;

/**
 * Натальные орбы — середина современного консенсуса с двумя поправками.
 *
 * Углы: соединение и оппозиция 8°, остальное 5°. Планета у самого угла звучит
 * громко, поэтому соединению оставляем широкий орб; прочие аспекты к углам
 * уже, потому что углы висят на времени рождения — 4 минуты ошибки сдвигают
 * ASC примерно на градус. Важное свойство: аспект к одному концу оси — это
 * всегда аспект и к другому (трин к MC = секстиль к IC), и орб по обе стороны
 * одинаковый. С планетными орбами (трин 6°, секстиль 4°) пара могла
 * разойтись: трин в списке есть, а секстиль к противоположному углу — нет.
 *
 * Светила: +2°, если в паре Солнце или Луна, — самая общепринятая поправка.
 * Добавляется и к углам: обе стороны оси получают её одинаково, симметрия
 * не ломается.
 */
export const natalOrb: OrbRule = (def, a, b) => {
	const base = isAngle(a) || isAngle(b) ? (def.angle === 0 || def.angle === 180 ? 8 : 5) : def.orb;
	return base + (isLuminary(a) || isLuminary(b) ? 2 : 0);
};

/**
 * Транзиты — 1° для любого аспекта. Натальные 8° тут не годятся: транзит
 * действует, пока он близко к точному, и с широкими орбами колесо обрастало
 * тремя десятками хорд, большая часть которых по меркам астролога уже не
 * работает.
 *
 * Почему 1°, а не 2°: колесо отвечает на вопрос «что точно сейчас», а «когда»
 * говорит список точных транзитов. Медленным планетам и 1° даёт недели
 * (Сатурн в орбе 3–8 недель), при 2° его хорда висела бы до четырёх месяцев и
 * «сейчас» размывалось. Пустое колесо в какой-то день — не дефект: значит,
 * ничего точного не происходит.
 */
export const TRANSIT_ORB = 1;
export const transitOrb: OrbRule = () => TRANSIT_ORB;

export interface Aspect {
	from: AspectPoint;
	to: AspectPoint;
	def: AspectDef;
	/** Отклонение от точного угла в градусах — чем меньше, тем аспект сильнее. */
	orb: number;
}

/**
 * Аспекты между двумя наборами тел.
 *
 * Один набор (натал ↔ натал): передаём одинаковые массивы — тогда берём только
 * пары i<j, чтобы не дублировать. Два набора (транзит → натал): полное
 * декартово произведение, включая «планета к самой себе» — транзитный Сатурн
 * к натальному Сатурну это осмысленный аспект.
 */
export function findAspects(
	from: readonly AspectPoint[],
	to: readonly AspectPoint[],
	orbFor: OrbRule = natalOrb
): Aspect[] {
	const samePool = from === to;
	const out: Aspect[] = [];

	for (let i = 0; i < from.length; i++) {
		for (let j = samePool ? i + 1 : 0; j < to.length; j++) {
			const separation = angularDistance(from[i].longitude, to[j].longitude);
			for (const def of ASPECT_DEFS) {
				const orb = Math.abs(separation - def.angle);
				if (orb <= orbFor(def, from[i], to[j])) {
					out.push({ from: from[i], to: to[j], def, orb });
					// орбы не пересекаются даже с надбавкой светилам (самые широкие —
					// 10° у соединения, 6° у секстиля, 8° у квадрата и трина: между
					// ними остаются зазоры), поэтому первый подошедший — единственный
					break;
				}
			}
		}
	}
	// самые точные аспекты рисуем последними, чтобы они лежали сверху
	return out.sort((a, b) => b.orb - a.orb);
}

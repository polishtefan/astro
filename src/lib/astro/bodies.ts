import type { BodyId } from './types';

export interface BodyDef {
	id: BodyId;
	/** Номер тела в Swiss Ephemeris (SE_SUN, SE_MOON, ... — часть стабильного ABI). */
	sweId: number;
	glyph: string;
	/** Участвует ли в натальной аспектной сетке. */
	aspects: boolean;
	/** Показывается ли на транзитном кольце. */
	transiting: boolean;
	/**
	 * Точка ровно напротив тела sweId, а не само тело. Так считается южный
	 * узел: у Swiss Ephemeris отдельного номера для него нет, он всегда
	 * северный + 180°. Берём те же данные SE и разворачиваем — никакого
	 * приближения, точность та же, что у северного.
	 */
	opposite?: boolean;
}

export const BODIES: readonly BodyDef[] = [
	{ id: 'sun', sweId: 0, glyph: '☉', aspects: true, transiting: true },
	{ id: 'moon', sweId: 1, glyph: '☽', aspects: true, transiting: true },
	{ id: 'mercury', sweId: 2, glyph: '☿', aspects: true, transiting: true },
	{ id: 'venus', sweId: 3, glyph: '♀', aspects: true, transiting: true },
	{ id: 'mars', sweId: 4, glyph: '♂', aspects: true, transiting: true },
	{ id: 'jupiter', sweId: 5, glyph: '♃', aspects: true, transiting: true },
	{ id: 'saturn', sweId: 6, glyph: '♄', aspects: true, transiting: true },
	{ id: 'uranus', sweId: 7, glyph: '♅', aspects: true, transiting: true },
	{ id: 'neptune', sweId: 8, glyph: '♆', aspects: true, transiting: true },
	{ id: 'pluto', sweId: 9, glyph: '♇', aspects: true, transiting: true },
	// SE_TRUE_NODE — истинный (осциллирующий) узел, не средний.
	{ id: 'node', sweId: 11, glyph: '☊', aspects: false, transiting: false },
	{ id: 'southNode', sweId: 11, glyph: '☋', aspects: false, transiting: false, opposite: true },
	{ id: 'chiron', sweId: 15, glyph: '⚷', aspects: false, transiting: false }
];

export const BODY_BY_ID: Record<BodyId, BodyDef> = Object.fromEntries(
	BODIES.map((b) => [b.id, b])
) as Record<BodyId, BodyDef>;

/** Тела на транзитном кольце — только классическая десятка, как в прототипе. */
export const TRANSIT_BODIES = BODIES.filter((b) => b.transiting);

/**
 * Наборы для поиска точных транзитов.
 *
 * «Медленные» — от Юпитера и дальше: их транзиты длятся неделями и месяцами,
 * это то, ради чего список и смотрят. «Все» добавляют Солнце, Меркурий, Венеру
 * и Марс — их точек за полгода в обе стороны уже сотни.
 *
 * Луна в пресеты не входит: она обходит зодиак за 27 дней и касается каждой из
 * 96 точек аспектов ежемесячно — около 1250 событий за год против 370 у всех
 * остальных вместе. В общем списке она утопила бы всё. Выбрать её отдельной
 * кнопкой можно: лунные аспекты нужны для выбора дня и часа, а не для обзора
 * на месяцы вперёд.
 */
const SLOW: readonly BodyId[] = ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
export const EXACT_SLOW_BODIES = BODIES.filter((b) => SLOW.includes(b.id));
export const EXACT_ALL_BODIES = TRANSIT_BODIES.filter((b) => b.id !== 'moon');
/** Кнопки выбора одной планеты — здесь Луна есть. */
export const EXACT_FILTER_BODIES = TRANSIT_BODIES;

/**
 * Натальные точки-планеты для фильтра «к чему». Те же тела, что в аспектной
 * сетке: к узлу и Хирону точные транзиты не ищутся, кнопка для них была бы
 * всегда пустой.
 */
export const NATAL_TARGET_BODIES = BODIES.filter((b) => b.aspects);

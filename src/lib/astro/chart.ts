import type SwissEPH from 'sweph-wasm';
import { ASPECT_DEFS } from './aspects';
import { BODIES, BODY_BY_ID, type BodyDef } from './bodies';
import { loadEphemeris } from './ephemeris';
import { dateToJd, findExactAspects, type ExactHit, type ExactTarget } from './exact';
import { norm360 } from './format';
import { birthMomentToUtc, utcParts } from './time';
import type { BirthData, BodyPosition, Chart, HouseFrame } from './types';

/** Placidus по умолчанию — код системы домов в Swiss Ephemeris. */
export const DEFAULT_HOUSE_SYSTEM = 'P';

/**
 * Юлианский день UT для момента.
 *
 * swe_utc_to_jd умеет високосные секунды и возвращает пару [ET, UT];
 * нам нужен UT — под него заточены swe_calc_ut и swe_houses.
 */
function julianDayUt(swe: SwissEPH, at: Date): number {
	const p = utcParts(at);
	const [, ut] = swe.swe_utc_to_jd(p.year, p.month, p.day, p.hour, p.minute, p.second, swe.SE_GREG_CAL);
	return ut;
}

/** Номер дома (1–12) для долготы по фактическим куспидам — они неравные у Placidus. */
export function houseOf(longitude: number, cusps: number[]): number {
	const lon = norm360(longitude);
	for (let i = 0; i < 12; i++) {
		const start = cusps[i];
		const end = cusps[(i + 1) % 12];
		// дуга дома, отсчитанная вперёд от куспида; так корректно ловим переход через 0°
		const span = norm360(end - start);
		const offset = norm360(lon - start);
		if (offset < span) return i + 1;
	}
	return 1;
}

function calcBody(swe: SwissEPH, jd: number, def: BodyDef, cusps: number[]): BodyPosition {
	const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
	const [rawLongitude, rawLatitude, , speed] = swe.swe_calc_ut(jd, def.sweId, flags);
	/*
	 * Противоположная точка (южный узел): долгота +180°, широта с обратным
	 * знаком. Скорость та же — две точки движутся как одна ось, поэтому и
	 * ретроградность у них всегда общая.
	 */
	const longitude = def.opposite ? rawLongitude + 180 : rawLongitude;
	const latitude = def.opposite ? -rawLatitude : rawLatitude;
	return {
		id: def.id,
		longitude: norm360(longitude),
		latitude,
		speed,
		retrograde: speed < 0,
		house: houseOf(longitude, cusps)
	};
}

/** Дома и углы от места и момента рождения. */
function calcHouses(swe: SwissEPH, jd: number, birth: BirthData): HouseFrame {
	const raw = swe.swe_houses(jd, birth.latitude, birth.longitude, DEFAULT_HOUSE_SYSTEM);
	// Swiss Ephemeris отдаёт массив из 13 элементов: cusps[0] не используется,
	// куспид I дома лежит в cusps[1] — приводим к нормальному 0-индексу.
	const cusps = Array.from(raw.cusps).slice(1, 13).map(norm360);
	return {
		cusps,
		ascendant: norm360(raw.ascmc[0]),
		midheaven: norm360(raw.ascmc[1]),
		system: DEFAULT_HOUSE_SYSTEM
	};
}

/**
 * Карта на произвольный момент наблюдения.
 *
 * Дома всегда считаются от рождения: они — рамка карты, и транзиты ложатся
 * именно на неё. Натал получается тем же вызовом с observation = момент рождения.
 */
export async function computeChart(birth: BirthData, observation?: Date): Promise<Chart> {
	const swe = await loadEphemeris();
	const birthUtc = birthMomentToUtc(birth.date, birth.time, birth.timezone);
	const at = observation ?? birthUtc;

	const houses = calcHouses(swe, julianDayUt(swe, birthUtc), birth);
	const jd = julianDayUt(swe, at);
	const positions = BODIES.map((def) => calcBody(swe, jd, def, houses.cusps));

	return { birth, observation: at, julianDay: jd, positions, houses };
}

/**
 * Только положения тел на момент — для транзитного кольца.
 * Дома переиспользуем натальные, второй раз их считать незачем.
 */
export async function computePositions(
	at: Date,
	frame: HouseFrame,
	bodies: readonly BodyDef[] = BODIES
): Promise<BodyPosition[]> {
	const swe = await loadEphemeris();
	const jd = julianDayUt(swe, at);
	return bodies.map((def) => calcBody(swe, jd, def, frame.cusps));
}

/**
 * Углы карты как точки для аспектов: все четыре — ASC, IC, DSC, MC.
 *
 * DSC и IC лежат ровно напротив ASC и MC, поэтому каждый аспект к оси виден
 * с обоих концов: «Марс в оппозиции ASC» — это и «Марс в соединении с DSC»,
 * квадрат к ASC — одновременно квадрат к DSC. Это сознательно: у каждого угла
 * свой смысл (ASC — я, DSC — другие), и аспект читают от того конца, к
 * которому он ближе по смыслу. Список от этого длиннее, но ничего не прячется.
 *
 * Промежуточные куспиды (II, III, V…) не берём: в Плацидусе они зависят от
 * метода деления домов, и аспекты к ним почти никто не читает.
 */
export function chartAngles(houses: HouseFrame): ExactTarget[] {
	return [
		{ id: 'asc', longitude: houses.ascendant },
		{ id: 'ic', longitude: norm360(houses.midheaven + 180) },
		{ id: 'dsc', longitude: norm360(houses.ascendant + 180) },
		{ id: 'mc', longitude: houses.midheaven }
	];
}

/**
 * Натальные точки для поиска точных транзитов: планеты, участвующие в
 * аспектной сетке, плюс четыре угла — к ним транзиты тоже значимы.
 */
export function exactTargets(chart: Chart): ExactTarget[] {
	return [
		...chart.positions
			.filter((p) => BODY_BY_ID[p.id].aspects)
			.map((p) => ({ id: p.id, longitude: p.longitude })),
		...chartAngles(chart.houses)
	];
}

/**
 * Точные аспекты транзитных планет к натальной карте в окне [from, to].
 *
 * onlyTarget сужает поиск до одной натальной точки — «что касается моего
 * ASC». Отбрасываем лишние точки до поиска, а не фильтруем готовый список:
 * бисекция по остальным точкам — лишняя работа, которую потом выкинем.
 */
export async function computeExactTransits(
	chart: Chart,
	from: Date,
	to: Date,
	transiting: readonly BodyDef[],
	onlyTarget?: string
): Promise<ExactHit[]> {
	const targets = exactTargets(chart).filter((p) => !onlyTarget || p.id === onlyTarget);
	const swe = await loadEphemeris();
	const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
	return findExactAspects(
		(jd, sweId) => {
			const [longitude, , , speed] = swe.swe_calc_ut(jd, sweId, flags);
			return { longitude, speed };
		},
		{
			transiting,
			targets,
			aspects: ASPECT_DEFS,
			fromJd: dateToJd(from),
			toJd: dateToJd(to)
		}
	);
}

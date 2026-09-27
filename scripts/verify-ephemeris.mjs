/**
 * Проверка расчётного ядра без запуска приложения:  npm run verify
 *
 * Смысл в том, чтобы сверить Swiss Ephemeris с НЕЗАВИСИМЫМ путём вычисления,
 * а не с её же собственным выводом. Поэтому здесь с нуля выведены:
 *   • долгота Солнца — по солнечной теории низкой точности (Meeus, гл. 25);
 *   • GMST по IAU 1982 и наклонность эклиптики по IAU 1980 → ASC и MC.
 *
 * Если бы мы перепутали широту с долготой, знак восточной долготы, UT с
 * локальным временем или юлианский день — расхождение было бы в градусах.
 * Поэтому порог задан жёстко, в секундах дуги.
 *
 * Отдельно проверяется поиск точных транзитов: момент, когда Солнце
 * соединяется, образует квадрат и оппозицию к 0° Овна, — это равноденствия и
 * солнцестояния, их время публикует Военно-морская обсерватория США (USNO).
 *
 * Пороги:
 *   Солнце — 60″: у формулы Meeus заявленная точность порядка 1′.
 *   ASC/MC — 60″: SE считает по истинному равноденствию даты, наша формула по
 *   среднему; разница (нутация по долготе) доходит до ~17″.
 *   Сезоны — 1 минута: USNO публикует время с точностью до минуты.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import SwissEPH from 'sweph-wasm';
// .ts из .mjs: Node 22+ умеет срезать типы сам; в exact.ts только type-импорты
import { dateToJd, findExactAspects } from '../src/lib/astro/exact.ts';

const D = Math.PI / 180;
const R = 180 / Math.PI;
const norm = (deg) => ((deg % 360) + 360) % 360;
/** Знаковая разница двух углов в секундах дуги. */
const arcsec = (a, b) => Math.abs(((a - b + 540) % 360) - 180) * 3600;

// ── независимые формулы ──────────────────────────────────────────────

/** Видимая геоцентрическая долгота Солнца, Meeus «Astronomical Algorithms», гл. 25. */
function sunLongitude(jd) {
	const T = (jd - 2451545.0) / 36525;
	const L0 = norm(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
	const M = norm(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
	const C =
		(1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * D) +
		(0.019993 - 0.000101 * T) * Math.sin(2 * M * D) +
		0.000289 * Math.sin(3 * M * D);
	const trueLon = L0 + C;
	// приведение к видимой долготе: нутация + аберрация
	const omega = 125.04 - 1934.136 * T;
	return norm(trueLon - 0.00569 - 0.00478 * Math.sin(omega * D));
}

/** Среднее гринвичское звёздное время в градусах, IAU 1982. */
function gmst(jd) {
	const T = (jd - 2451545.0) / 36525;
	return norm(
		280.46061837 +
			360.98564736629 * (jd - 2451545.0) +
			0.000387933 * T * T -
			(T * T * T) / 38710000
	);
}

/** Средняя наклонность эклиптики в градусах, IAU 1980. */
function obliquity(jd) {
	const T = (jd - 2451545.0) / 36525;
	return (84381.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T) / 3600;
}

/** ASC и MC из сферической тригонометрии — без обращения к Swiss Ephemeris. */
function ascMc(jd, latDeg, lonDeg) {
	const ramc = norm(gmst(jd) + lonDeg) * D;
	const eps = obliquity(jd) * D;
	const phi = latDeg * D;
	return {
		mc: norm(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) * R),
		asc: norm(
			Math.atan2(
				Math.cos(ramc),
				-(Math.sin(eps) * Math.tan(phi) + Math.cos(eps) * Math.sin(ramc))
			) * R
		)
	};
}

// ── прогон ───────────────────────────────────────────────────────────

// файлы эфемерид грузятся через fetch, поэтому раздаём static/ по http
const server = http
	.createServer((req, res) => {
		try {
			res.end(readFileSync('static' + req.url));
		} catch {
			res.statusCode = 404;
			res.end();
		}
	})
	.listen(0);
const port = server.address().port;

const swe = await SwissEPH.init(`http://127.0.0.1:${port}/swisseph.wasm`);
await swe.swe_set_ephe_path(`http://127.0.0.1:${port}/ephe/`);

let failures = 0;
function check(label, deltaArcsec, tolerance) {
	const ok = deltaArcsec <= tolerance;
	if (!ok) failures++;
	console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} Δ ${deltaArcsec.toFixed(1).padStart(6)}″`);
}

const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
const jdOf = (y, mo, d, h, mi) => swe.swe_utc_to_jd(y, mo, d, h, mi, 0, swe.SE_GREG_CAL)[1];

console.log('\nДолгота Солнца — Swiss Ephemeris против солнечной теории Meeus');
for (const [y, mo, d, h, mi] of [
	[2000, 1, 1, 12, 0],
	[1969, 7, 20, 20, 17],
	[2026, 8, 26, 0, 0],
	[1899, 12, 31, 12, 0]
]) {
	const jd = jdOf(y, mo, d, h, mi);
	const [se] = swe.swe_calc_ut(jd, swe.SE_SUN, flags);
	check(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}  ${se.toFixed(5)}°`, arcsec(se, sunLongitude(jd)), 60);
}

console.log('\nASC и MC (Placidus) — Swiss Ephemeris против сферической тригонометрии');
for (const [label, y, mo, d, h, mi, lat, lon] of [
	['Москва      1995-06-14 05:20 UT', 1995, 6, 14, 5, 20, 55.7558, 37.6173],
	['Нью-Йорк    1980-11-03 22:47 UT', 1980, 11, 3, 22, 47, 40.7128, -74.006],
	['Сидней      2003-02-28 14:05 UT', 2003, 2, 28, 14, 5, -33.8688, 151.2093],
	['Рейкьявик   1968-12-21 03:00 UT', 1968, 12, 21, 3, 0, 64.1466, -21.9426]
]) {
	const jd = jdOf(y, mo, d, h, mi);
	const houses = swe.swe_houses(jd, lat, lon, 'P');
	// SE отдаёт 13 элементов: cusps[0] не используется, куспид I дома в cusps[1]
	const cusps = Array.from(houses.cusps).slice(1, 13).map(norm);
	const mine = ascMc(jd, lat, lon);

	console.log(`  ${label}`);
	check(`  ASC ${houses.ascmc[0].toFixed(4)}°`, arcsec(houses.ascmc[0], mine.asc), 60);
	check(`  MC  ${houses.ascmc[1].toFixed(4)}°`, arcsec(houses.ascmc[1], mine.mc), 60);
	check('  инвариант: куспид I = ASC', arcsec(cusps[0], houses.ascmc[0]), 1);
	check('  инвариант: куспид X = MC', arcsec(cusps[9], houses.ascmc[1]), 1);
	check(
		'  инвариант: противолежащие куспиды в оппозиции',
		Math.max(...[0, 1, 2, 3, 4, 5].map((i) => arcsec(cusps[i] + 180, cusps[i + 6]))),
		1
	);
}

console.log('\nЭфемеридные файлы действительно подключены (иначе SE молча деградирует)');
{
	const jd = jdOf(2000, 1, 1, 12, 0);
	// Хирон живёт в seas_18.se1 — если файла нет, вызов упадёт
	const [chiron] = swe.swe_calc_ut(jd, swe.SE_CHIRON, flags);
	check(`  Хирон на J2000 = ${chiron.toFixed(4)}° (расчёт не упал)`, 0, 0);
}

console.log('\nТочные транзиты — поиск против сезонов 2024 года по данным USNO');
{
	const longitudeAt = (jd, sweId) => {
		const r = swe.swe_calc_ut(jd, sweId, flags);
		return { longitude: r[0], speed: r[3] };
	};
	const aspect = (id, angle) => ({ id, label: id, glyph: '', angle, orb: 0, quality: 'hard' });
	const hits = findExactAspects(longitudeAt, {
		transiting: [{ id: 'sun', sweId: swe.SE_SUN }],
		targets: [{ id: 'aries0', longitude: 0 }],
		aspects: [aspect('conjunction', 0), aspect('square', 90), aspect('opposition', 180)],
		fromJd: dateToJd(new Date('2024-01-01T00:00:00Z')),
		toJd: dateToJd(new Date('2025-01-01T00:00:00Z'))
	});
	// https://aa.usno.navy.mil/data/EarthSeasons
	const usno = [
		['весеннее равноденствие', '2024-03-20T03:06:00Z'],
		['летнее солнцестояние ', '2024-06-20T20:51:00Z'],
		['осеннее равноденствие ', '2024-09-22T12:44:00Z'],
		['зимнее солнцестояние ', '2024-12-21T09:20:00Z']
	];
	if (hits.length !== usno.length) {
		failures++;
		console.log(`  ✗ найдено ${hits.length} событий вместо ${usno.length}`);
	}
	usno.forEach(([label, iso], i) => {
		const found = hits[i]?.date;
		const deltaMin = found ? Math.abs(found.getTime() - new Date(iso).getTime()) / 60000 : Infinity;
		const ok = deltaMin <= 1;
		if (!ok) failures++;
		console.log(`  ${ok ? '✓' : '✗'} ${label}  ${found?.toISOString().slice(0, 16) ?? '—'}Z  Δ ${deltaMin.toFixed(2)} мин`);
	});
}

server.close();
console.log(failures === 0 ? '\nВсё сошлось.\n' : `\nПровалено проверок: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);

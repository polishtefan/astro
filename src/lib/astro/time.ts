/**
 * Перевод «локальное время рождения + IANA-таймзона» → UTC.
 *
 * Swiss Ephemeris работает в UT, а человек называет время по настенным часам
 * места рождения. Готовой функции в платформе нет, поэтому считаем смещение
 * через Intl: у него полная база tzdata, включая исторические переводы часов
 * (для СССР это критично — там переходы шли не по нынешним правилам).
 */

/** Смещение зоны от UTC в минутах в конкретный момент времени (восток положительный). */
function zoneOffsetMinutes(timeZone: string, at: Date): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
		.formatToParts(at)
		.find((p) => p.type === 'timeZoneName')?.value;

	// 'GMT+03:00' | 'GMT-05:30' | 'GMT' (для UTC±0)
	const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
	if (!m) return 0;
	const sign = m[1] === '-' ? -1 : 1;
	return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Локальные компоненты времени в зоне → момент UTC.
 *
 * Смещение зависит от самого момента (лето/зима), а момент — от смещения,
 * поэтому идём в два прохода: первая оценка, затем уточнение уже по найденной
 * точке. Этого достаточно везде, кроме собственно часа перевода стрелок —
 * там ответ неоднозначен и мы берём смещение «после перехода».
 */
export function zonedTimeToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string
): Date {
	const asUtc = Date.UTC(year, month - 1, day, hour, minute);
	const firstGuess = asUtc - zoneOffsetMinutes(timeZone, new Date(asUtc)) * 60_000;
	const refined = asUtc - zoneOffsetMinutes(timeZone, new Date(firstGuess)) * 60_000;
	return new Date(refined);
}

/** Разбор 'YYYY-MM-DD' + 'HH:mm' в момент UTC с учётом зоны. */
export function birthMomentToUtc(date: string, time: string, timeZone: string): Date {
	const [y, mo, d] = date.split('-').map(Number);
	const [h, mi] = time.split(':').map(Number);
	return zonedTimeToUtc(y, mo, d, h, mi ?? 0, timeZone);
}

/** UTC-компоненты момента — то, что дальше уходит в swe_utc_to_jd. */
export function utcParts(at: Date) {
	return {
		year: at.getUTCFullYear(),
		month: at.getUTCMonth() + 1,
		day: at.getUTCDate(),
		hour: at.getUTCHours(),
		minute: at.getUTCMinutes(),
		second: at.getUTCSeconds() + at.getUTCMilliseconds() / 1000
	};
}

/** Список зон для селекта; Intl.supportedValuesOf есть во всех целевых браузерах. */
export function listTimeZones(): string[] {
	try {
		return Intl.supportedValuesOf('timeZone');
	} catch {
		return [Intl.DateTimeFormat().resolvedOptions().timeZone];
	}
}

// ── человеческие форматы даты и времени ──────────────────────────────
//
// Внутри BirthData дата всегда хранится как ISO 'YYYY-MM-DD', а время как
// 'HH:mm' в 24 часах — это однозначно и удобно сортировать. Всё, что видит
// человек, проходит через функции ниже.

/** '1995-06-14' → '14.06.1995'. День первым — как принято здесь. */
export function formatDate(iso: string): string {
	const [y, m, d] = iso.split('-');
	return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** Сколько дней в месяце — с високосными годами по григорианскому правилу. */
function daysInMonth(year: number, month: number): number {
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * '14.06.1995' → '1995-06-14', или null если разобрать не вышло.
 *
 * Разделитель любой (точка, слэш, дефис, пробел), можно и подряд восемь цифр.
 * Год ограничен 1800–2400: это диапазон подключённых файлов эфемерид, за его
 * пределами Swiss Ephemeris посчитать не сможет.
 */
export function parseDate(text: string): string | null {
	const digits = text.trim().replace(/\D/g, '');
	let d: number, m: number, y: number;

	if (/^\d{8}$/.test(digits)) {
		d = Number(digits.slice(0, 2));
		m = Number(digits.slice(2, 4));
		y = Number(digits.slice(4));
	} else {
		const parts = text.trim().split(/\D+/).filter(Boolean);
		if (parts.length !== 3) return null;
		[d, m, y] = parts.map(Number);
	}

	if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
	if (y < 1800 || y > 2400) return null;
	if (m < 1 || m > 12) return null;
	if (d < 1 || d > daysInMonth(y, m)) return null;

	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '9:5' → '09:05', или null если это не время суток. */
export function parseTime(text: string): string | null {
	const digits = text.trim().replace(/\D/g, '');
	let h: number, mi: number;

	if (/^\d{3,4}$/.test(digits) && !text.includes(':')) {
		h = Number(digits.slice(0, digits.length - 2));
		mi = Number(digits.slice(-2));
	} else {
		const parts = text.trim().split(/\D+/).filter(Boolean);
		if (parts.length !== 2) return null;
		[h, mi] = parts.map(Number);
	}

	if (!Number.isInteger(h) || !Number.isInteger(mi)) return null;
	if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
	return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** '21:20' → '9:20 PM'. Подсказка рядом с 24-часовым полем. */
export function to12Hour(hhmm: string): string {
	const [h, mi] = hhmm.split(':').map(Number);
	if (!Number.isInteger(h) || !Number.isInteger(mi)) return '';
	const suffix = h < 12 ? 'AM' : 'PM';
	const hour12 = h % 12 === 0 ? 12 : h % 12;
	return `${hour12}:${String(mi).padStart(2, '0')} ${suffix}`;
}

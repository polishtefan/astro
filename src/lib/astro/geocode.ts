/**
 * Поиск места рождения.
 *
 * Расчёту нужны три вещи, которые человек не знает наизусть: широта, долгота и
 * часовой пояс. Геокодер Open-Meteo отдаёт всё три сразу, работает без ключа и
 * без регистрации, понимает и кириллицу, и латиницу, и умеет отдавать названия
 * по-русски.
 *
 * Часовой пояс здесь — самое ценное. Взять координаты можно откуда угодно, а
 * вот сопоставить точку с IANA-зоной без большой базы нельзя, и ошибка в зоне
 * сдвигает ASC на десятки градусов.
 */

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export interface Place {
	id: number;
	name: string;
	/** Регион: «Харьковская область». Может отсутствовать у мелких мест. */
	admin1?: string;
	country: string;
	latitude: number;
	longitude: number;
	/** IANA-зона, например 'Europe/Kyiv'. */
	timezone: string;
	population?: number;
}

interface RawResult {
	id: number;
	name: string;
	admin1?: string;
	country?: string;
	latitude: number;
	longitude: number;
	timezone?: string;
	population?: number;
}

/** «Харьков · Харьковская область, Украина» — строка для списка результатов. */
export function describePlace(place: Place): string {
	return [place.admin1, place.country].filter(Boolean).join(', ');
}

/**
 * Язык запроса к геокодеру.
 *
 * Параметр language у Open-Meteo влияет не только на названия в ответе, но и
 * на сам поиск: латиницу он находит на любом языке, а кириллицу — только если
 * язык совпадает с языком написания. «Харьков» с language=en даёт первым
 * посёлок «Khar'kovka» под Волгоградом, а украинское «Харків» находится только
 * с language=uk. Поэтому для кириллицы язык выбираем по самому запросу, а для
 * латиницы — по интерфейсу.
 */
function searchLanguage(query: string): string {
	if (/[іїєґІЇЄҐ]/.test(query)) return 'uk'; // буквы, которых нет в русском
	if (/[а-яёА-ЯЁ]/.test(query)) return 'ru';
	return 'en';
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
	const name = query.trim();
	if (name.length < 2) return [];

	const language = searchLanguage(name);
	const url = `${ENDPOINT}?name=${encodeURIComponent(name)}&count=8&language=${language}&format=json`;
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);

	const data = (await response.json()) as { results?: RawResult[] };
	return (data.results ?? [])
		// без зоны результат бесполезен — считать по нему нельзя
		.filter((r): r is RawResult & { timezone: string } => Boolean(r.timezone))
		.map((r) => ({
			id: r.id,
			name: r.name,
			admin1: r.admin1,
			country: r.country ?? '',
			latitude: r.latitude,
			longitude: r.longitude,
			timezone: r.timezone,
			population: r.population
		}));
}

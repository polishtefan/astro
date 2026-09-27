/**
 * Все тексты интерфейса.
 *
 * Раньше здесь жили два словаря и машинерия языков — определение по cookie,
 * контекст, серверный хук. Интерфейс теперь только английский, поэтому остался
 * один объект: тексты по-прежнему собраны в одном месте, но без переключения.
 *
 * Астрологические условности не переводятся и не менялись: подписи домов
 * As/Ic/Ds/Mc, символы знаков и планет, ℞ — это общая нотация, а не слова.
 */

const SIGNS = [
	'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
	'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

export const t = {
	houseSystem: 'Placidus',
	rising: (i: number) => `${SIGNS[i]} rising`,
	computing: 'Computing ephemerides…',
	calcError: 'Calculation error',

	natal: 'Natal',
	transits: 'Transits',
	synastry: 'Synastry',
	partner: 'Partner',
	partnerEdit: 'edit',
	partnerCancel: 'cancel',
	compare: 'Compare',
	noSynastryAspects: 'No major aspects between the two charts.',
	transitingPositions: 'transiting positions',
	minus6mo: '−6 mo',
	today: 'today',
	plus6mo: '+6 mo',
	// подсказка и имя для экранного диктора у кнопки «today» под шкалой
	backToToday: 'Back to today',
	monthsShort: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],

	exactTransits: 'Exact transits',
	exactSlow: 'Slow',
	exactAll: 'All',
	exactSearching: 'Searching…',
	exactNone: 'No exact transits in these six months either way',
	// «Nothing exact from Saturn to natal Sun…» — одна фраза на любое сочетание
	// фильтров, без согласования глагола с «планетой» или «планетами»
	exactNoneFiltered: (from: string, to: string) =>
		`Nothing exact from ${from} to ${to} in these six months either way`,
	exactFromSlow: 'the slow planets',
	exactFromAll: 'any planet',
	exactToAny: 'any natal point',
	natalOf: (name: string) => `natal ${name}`,
	// подписи двух рядов фильтра — две стороны аспекта: кто движется и к чему
	exactFromLabel: 'Transiting',
	exactToLabel: 'To natal',
	exactAny: 'Any',
	exactFilterAria: 'Transiting planets',
	exactTargetFilterAria: 'Natal points',
	exactHint: 'Click a row to see that moment on the wheel.',
	exactMoonWindow: 'The Moon is shown one month either way — it aspects everything every month.',
	// индексируется id аспекта, поэтому тип со строковым ключом, а не вывод по литералам
	aspectVerbs: {
		conjunction: 'conjunct',
		sextile: 'sextile',
		square: 'square',
		trine: 'trine',
		opposition: 'opposite'
	} as Record<string, string>,

	positions: 'Positions',
	houses: 'Houses',
	house: 'House',
	cusp: 'Cusp',
	inHouse: 'In house',
	transiting: 'Transiting',
	aspects: 'Aspects',
	orb: 'Orb',
	noAspects: 'No major aspects between the planets.',
	aspectFilterAria: 'Filter aspects by planet',
	aspectPlanetLabel: 'Planet',
	noAspectsFiltered: 'No major aspects for this selection.',
	planet: 'Planet',
	natalColumn: 'Natal',
	transitColumn: 'Transit',
	bodies: {
		sun: 'Sun',
		moon: 'Moon',
		mercury: 'Mercury',
		venus: 'Venus',
		mars: 'Mars',
		jupiter: 'Jupiter',
		saturn: 'Saturn',
		uranus: 'Uranus',
		neptune: 'Neptune',
		pluto: 'Pluto',
		// «Node» без уточнения стал двусмысленным, когда появился южный
		node: 'North Node',
		southNode: 'South Node',
		chiron: 'Chiron'
	},
	signsShort: ['Ari', 'Tau', 'Gem', 'Can', 'Leo', 'Vir', 'Lib', 'Sco', 'Sag', 'Cap', 'Aqu', 'Pis'],

	theme: 'Theme',
	day: 'Day',
	night: 'Night',
	signsPalette: 'Signs',
	mono: 'Mono',
	elements: 'Elements',
	settingsAria: 'Settings',

	birthData: 'birth data',
	close: '× close',
	name: 'Name',
	birthplace: 'Birthplace',
	birthplacePlaceholder: 'start typing a city',
	searching: 'Searching…',
	searchFailed: 'Couldn’t find the city — enter coordinates and time zone manually.',
	placeStale: 'Pick a city from the list — otherwise the coordinates stay the same.',
	date: 'Date',
	datePlaceholder: 'DD.MM.YYYY',
	dateInvalid: 'day.month.year, years 1800–2400',
	time: 'Time',
	timePlaceholder: 'HH:MM',
	timeInvalid: '24-hour, e.g. 09:20 or 21:20',
	coordsSection: 'Filled in from the city — you can adjust',
	latitude: 'Latitude',
	longitude: 'Longitude',
	timezone: 'Time zone',
	recalculate: 'Recalculate',

	// подвал страницы: как считается, что с данными, чья работа
	footerEngine:
		// неразрывный пробел внутри скобок: иначе «(©» оставалось в конце строки,
		// а «Astrodienst)» уезжало на следующую
		'Positions and houses are computed with Swiss Ephemeris (©\u00a0Astrodienst) right in your browser.',
	// «Open-Meteo» отдельно: в разметке он неразрывный, иначе строка ломалась
	// на дефисе — «Open-» в конце одной строки, «Meteo.» на следующей
	footerPrivacy:
		'Nothing is stored — your birth data never leaves this page; only the city search goes to',
	footerGeocoder: 'Open-Meteo',
	// пунктами, а не одной строкой: каждый пункт переносится целиком
	footerMethod: ['Placidus houses', 'true node', 'major aspects'],
	footerAuthor: 'Made by Poli',
	wheelLabel: 'Natal chart wheel',
	layerAria: 'Chart layer',
	scrubAria: 'Date offset in days'
};

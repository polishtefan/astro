<script lang="ts">
	import { browser } from '$app/environment';
	import { fade } from 'svelte/transition';
	import { ANGLE_IDS, findAspects, transitOrb, type Aspect } from '$lib/astro/aspects';
	import { ASPECT_DEFS } from '$lib/astro/aspects';
	import {
		BODIES,
		BODY_BY_ID,
		EXACT_ALL_BODIES,
		EXACT_FILTER_BODIES,
		EXACT_SLOW_BODIES,
		NATAL_TARGET_BODIES,
		TRANSIT_BODIES
	} from '$lib/astro/bodies';
	import {
		chartAngles,
		computeChart,
		computeExactTransits,
		computePositions,
		houseOf
	} from '$lib/astro/chart';
	import type { ExactHit } from '$lib/astro/exact';
	import { toZodiac } from '$lib/astro/format';
	import { formatDate, to12Hour } from '$lib/astro/time';
	import { appearance, setPalette, setTheme, syncAppearanceFromDom } from '$lib/appearance.svelte';
	import type { BirthData, BodyId, BodyPosition, Chart } from '$lib/astro/types';
	import { t } from '$lib/copy';
	import BirthForm from '$lib/ui/BirthForm.svelte';
	import Wheel from '$lib/wheel/Wheel.svelte';

	/*
	 * Проявления в панели. Переходы Svelte не смотрят на системную настройку
	 * «уменьшить движение» сами, поэтому проверяем её вручную.
	 */
	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const FADE = reduceMotion ? 0 : 250;

	/*
	 * Карта, с которой открывается страница. Человек вымышленный: код
	 * открытый, и настоящие данные рождения в нём увидел бы кто угодно — а в
	 * истории git они остались бы навсегда. Город реальный, чтобы координаты
	 * и зона были настоящими.
	 */
	const SAMPLE: BirthData = {
		name: 'Mira',
		date: '1994-11-08',
		time: '07:45',
		place: 'Lisbon',
		latitude: 38.72225,
		longitude: -9.13933,
		timezone: 'Europe/Lisbon'
	};

	let birth = $state<BirthData>(SAMPLE);
	let mode = $state<'natal' | 'transits' | 'synastry'>('natal');
	let dayOffset = $state(0);
	let showForm = $state(false);

	let chart = $state<Chart | null>(null);
	let transits = $state<BodyPosition[] | null>(null);
	let error = $state<string | null>(null);

	// тема уже стоит на <html> — забираем её в состояние, чтобы кнопки знали, что нажато
	$effect(() => {
		if (browser) syncAppearanceFromDom();
	});

	/** «Сегодня» фиксируем один раз, иначе скраббер плыл бы вместе с часами. */
	const today = new Date();
	const DAY = 86_400_000;
	/** Окно скраббера и поиска точных транзитов — полгода в обе стороны. */
	const WINDOW_DAYS = 180;
	/*
	 * Для Луны окно уже. За полгода она даёт около 1250 точных аспектов: искать
	 * их полсекунды, а нарисовать полторы — панель заметно подвисает. И смысла
	 * в таком списке нет: лунный аспект точен в 14:32 и к вечеру разошёлся, его
	 * смотрят, выбирая день и час, а не планируя месяцы.
	 */
	const MOON_WINDOW_DAYS = 30;

	/*
	 * Дата наблюдения. Ползунок шагает целыми сутками от «сегодня», а точный
	 * транзит случается в конкретную минуту. Клик по строке списка кладёт этот
	 * момент в exactMoment — колесо показывает аспект ровно точным; любое
	 * движение ползунка возвращает обычный режим.
	 */
	let selectedHit = $state<ExactHit | null>(null);
	const exactMoment = $derived(selectedHit?.date ?? null);
	const observation = $derived(exactMoment ?? new Date(today.getTime() + dayOffset * DAY));
	/*
	 * Колесо стоит на «сейчас»: ползунок в нуле и не выбран точный транзит.
	 * Точный транзит может прийтись и на сегодня, но это уже конкретная
	 * минута, а не «сейчас» — из него тоже есть куда вернуться.
	 */
	const isToday = $derived(dayOffset === 0 && selectedHit === null);

	// Натал: пересчитывается только при смене данных рождения.
	$effect(() => {
		if (!browser) return;
		const data = birth;
		let stale = false;
		computeChart(data)
			.then((next) => {
				if (!stale) {
					chart = next;
					error = null;
				}
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	// Транзиты: та же карта, другая дата наблюдения.
	$effect(() => {
		if (!browser || !chart || mode !== 'transits') {
			transits = null;
			return;
		}
		const frame = chart.houses;
		const at = observation;
		let stale = false;
		computePositions(at, frame, TRANSIT_BODIES)
			.then((next) => {
				if (!stale) transits = next;
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	// ── синастрия ───────────────────────────────────────────────────
	/*
	 * Синастрия устроена как транзиты, только внешнее кольцо — не небо на
	 * дату, а карта второго человека. Рамка карты (дома, углы) — твоя: вопрос
	 * «куда в моей жизни попадают его планеты». Карту партнёра считаем тем же
	 * computeChart, от его места и момента рождения.
	 *
	 * Партнёр живёт только в памяти вкладки, как и твои данные: ни логина, ни
	 * хранения у приложения нет.
	 */
	let partner = $state<BirthData | null>(null);
	let partnerChart = $state<Chart | null>(null);
	/** Форма партнёра раскрыта: его ещё нет или его правят. */
	let partnerEditing = $state(false);
	const showPartnerForm = $derived(partner === null || partnerEditing);

	/*
	 * Пустой шаблон для формы. Координаты — NaN, а не 0: поле остаётся пустым
	 * и обязательным, и карта не посчитается молча для точки 0°, 0° в Гвинейском
	 * заливе, если город не выбран из списка.
	 */
	const EMPTY_PARTNER: BirthData = {
		name: '',
		date: '',
		time: '',
		place: '',
		latitude: NaN,
		longitude: NaN,
		timezone: ''
	};

	$effect(() => {
		if (!browser || !partner) {
			partnerChart = null;
			return;
		}
		const data = partner;
		let stale = false;
		computeChart(data)
			.then((next) => {
				if (!stale) partnerChart = next;
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	/*
	 * Кольцо партнёра — та же десятка тел, что у транзитов. Дом пересчитываем
	 * по ТВОИМ куспидам: computeChart поставил ему дома из его собственной
	 * карты, а в синастрии смысл — в какой твой дом попала его планета.
	 */
	const partnerRing = $derived.by(() => {
		const c = chart;
		if (!c || !partnerChart) return null;
		return partnerChart.positions
			.filter((p) => BODY_BY_ID[p.id].transiting)
			.map((p) => ({ ...p, house: houseOf(p.longitude, c.houses.cusps) }));
	});

	/** Внешнее кольцо колеса: транзиты, партнёр или ничего. */
	const outer = $derived(mode === 'transits' ? transits : mode === 'synastry' ? partnerRing : null);

	// ── точные транзиты ─────────────────────────────────────────────
	/*
	 * Два независимых фильтра — по одному на каждую сторону аспекта.
	 *
	 * «Кто движется» (exactFrom): пресет «медленные»/«все» или одна планета.
	 * Выбор одиночный: под вопрос «что покажет Сатурн» это удобнее мультивыбора —
	 * не приходится снимать лишнее.
	 *
	 * «К чему» (exactTo): любая натальная точка или одна планета — «всё, что
	 * касается моей Венеры».
	 *
	 * Кнопок углов здесь нет — убраны намеренно. Третий ряд словами среди двух
	 * рядов глифов читался тяжело, а фильтр «только углы» нужен редко. Сами
	 * углы никуда не делись: аспекты к ASC/IC/DSC/MC ищутся всегда и стоят в
	 * списке при «Any» вперемешку с планетами.
	 *
	 * Независимые, а не один общий выбор: так сочетаются «Сатурн → что угодно»,
	 * «все → Венера» и «Сатурн → Солнце». Это один и тот же список, в который
	 * входят с двух концов, — толкование пары от способа входа не меняется.
	 */
	type ExactFrom = 'slow' | 'all' | BodyId;
	type ExactTo = 'any' | BodyId;
	let exactFrom = $state<ExactFrom>('slow');
	let exactTo = $state<ExactTo>('any');
	let exactHits = $state<ExactHit[] | null>(null);

	/*
	 * Поиск точных транзитов тяжёлый и синхронный: пока он идёт, страница
	 * стоит, и кольцо с хордами, которые должны были плавно проявиться, вместо
	 * этого возникали рывком через секунду вместе со списком. Поэтому при
	 * входе в режим транзитов поиск ждёт, пока колесо доиграет переход
	 * (450мс + запас), — а в панели это время висит «Searching…».
	 * Смена фильтров потом пересчитывает сразу, без ожидания.
	 */
	let exactDeferred = $state(false);
	$effect(() => {
		if (mode !== 'transits') return;
		exactDeferred = true;
		const id = setTimeout(() => (exactDeferred = false), 600);
		return () => clearTimeout(id);
	});

	// Список считается только в режиме транзитов и не зависит от положения
	// ползунка — окно всегда «сегодня ± полгода», так что клик по строке
	// гарантированно попадает в диапазон скраббера.
	$effect(() => {
		if (!browser || !chart || mode !== 'transits') return;
		if (exactDeferred) {
			exactHits = null;
			return;
		}
		const bodies =
			exactFrom === 'slow'
				? EXACT_SLOW_BODIES
				: exactFrom === 'all'
					? EXACT_ALL_BODIES
					: [BODY_BY_ID[exactFrom]];
		const target = exactTo === 'any' ? undefined : exactTo;
		const days = exactFrom === 'moon' ? MOON_WINDOW_DAYS : WINDOW_DAYS;
		const from = new Date(today.getTime() - days * DAY);
		const to = new Date(today.getTime() + days * DAY);
		let stale = false;
		exactHits = null;
		computeExactTransits(chart, from, to, bodies, target)
			.then((hits) => {
				if (!stale) exactHits = hits;
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	/*
	 * Вопрос «что касается моей Венеры» — про всё, что к ней подходит, а не
	 * только про медленные планеты: при «Slow» к одной точке за год приходит
	 * одно-два события. Поэтому выбор натальной точки переключает «Slow» на
	 * «All». Конкретную планету не трогаем: «Saturn» выбран осознанно, и
	 * «Сатурн → Солнце» — ровно тот вопрос, который задают.
	 */
	function selectTarget(id: BodyId) {
		exactTo = id;
		if (exactFrom === 'slow') exactFrom = 'all';
	}

	/** Пустой список: объясняем словами, какое именно сочетание ничего не дало. */
	const exactEmptyNote = $derived.by(() => {
		if (exactFrom === 'slow' && exactTo === 'any') return t.exactNone;
		const from =
			exactFrom === 'slow' ? t.exactFromSlow : exactFrom === 'all' ? t.exactFromAll : t.bodies[exactFrom];
		const to = exactTo === 'any' ? t.exactToAny : t.natalOf(t.bodies[exactTo]);
		return t.exactNoneFiltered(from, to);
	});

	const ASPECT_GLYPH = Object.fromEntries(ASPECT_DEFS.map((a) => [a.id, a.glyph]));
	const ANGLE_LABEL: Record<string, string> = { asc: 'ASC', ic: 'IC', dsc: 'DSC', mc: 'MC' };

	/** Номера домов римскими — теми же, что подписаны на колесе. */
	const HOUSE_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

	/** Имя и глиф натальной точки: планета из словаря или угол карты. */
	function targetName(id: string): string {
		return ANGLE_LABEL[id] ?? t.bodies[id as keyof typeof t.bodies];
	}
	function targetGlyph(id: string): string {
		return ANGLE_LABEL[id] ?? BODY_BY_ID[id as keyof typeof BODY_BY_ID].glyph;
	}

	const pad = (n: number) => String(n).padStart(2, '0');
	function shortDate(d: Date): string {
		return `${pad(d.getDate())} ${t.monthsShort[d.getMonth()]} ${d.getFullYear()}`;
	}
	/** Время точного аспекта — в часовом поясе того, кто смотрит. */
	function shortTime(d: Date): string {
		return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function showExact(hit: ExactHit) {
		selectedHit = hit;
		// ползунок ставим на ближайшие сутки, чтобы он не спорил с датой
		dayOffset = Math.round((hit.date.getTime() - today.getTime()) / DAY);
	}

	/** Первый транзит, который ещё впереди, — к нему прокручиваем список. */
	const nextIndex = $derived(exactHits ? exactHits.findIndex((h) => h.date >= today) : -1);

	// Обе секции панели сворачиваются: на длинных списках таблица уезжает далеко
	// вниз, и наоборот. Состояние держим в памяти — это выбор на время сессии,
	// а не настройка оформления.
	let exactOpen = $state(true);
	let positionsOpen = $state(true);
	let housesOpen = $state(true);
	let aspectsOpen = $state(true);

	/** Обёртка кнопки и формы — по ней отличаем клик внутри от клика мимо. */
	let birthNav = $state<HTMLDivElement>();

	let exactList = $state<HTMLOListElement>();
	$effect(() => {
		if (!exactList || nextIndex < 0) return;
		const row = exactList.children[nextIndex] as HTMLElement | undefined;
		if (!row) return;
		// у <ol> position: relative, поэтому offsetTop строки считается от самого
		// списка. Одну прошедшую строку оставляем сверху — видно, что было перед
		// ближайшим транзитом; остальные прошедшие — прокруткой вверх
		const previous = row.previousElementSibling as HTMLElement | null;
		exactList.scrollTop = Math.max(0, row.offsetTop - (previous?.offsetHeight ?? 0));
	});

	/** Тела, участвующие в аспектной сетке (без узла и Хирона). */
	const natalAspectBodies = $derived(
		chart ? chart.positions.filter((p) => BODY_BY_ID[p.id].aspects) : []
	);

	/** Четыре угла карты — к ним тоже строим аспекты, наравне с планетами. */
	const angles = $derived(chart ? chartAngles(chart.houses) : []);

	/**
	 * Аспекты натала к самому себе — для списка. Держим отдельно от aspects:
	 * там в режиме транзитов лежит сетка транзит → натал, а этот блок всегда
	 * про саму карту.
	 */
	const natalAspects = $derived.by(() => {
		/*
		 * Порядок как в таблице положений: Солнце, Луна, Меркурий… — сначала
		 * все аспекты Солнца, потом Луны и так далее. Так аспект конкретной
		 * планеты ищется глазами сразу, а не по всему списку.
		 *
		 * Сортировка по «от»: findAspects берёт пары i<j из пула в порядке
		 * BODIES, поэтому «от» — всегда планета раньше по списку, и аспект
		 * Солнце–Луна попадает в блок Солнца, а не Луны. Внутри блока — по «к»:
		 * планеты в том же порядке, углы после них (ASC, IC, DSC, MC).
		 */
		return byPlanetOrder(natalGrid());
	});

	/*
	 * Аспекты между картами — для списка и колеса в синастрии. «От» — твои
	 * точки (планеты и углы), «к» — планеты партнёра: строка читается как «моё
	 * Солнце в трине к его Венере». Орбы натальные: это тоже сравнение двух
	 * неподвижных карт, а не движение, как у транзитов. Углы партнёра пока не
	 * берём — на колесе у них нет своей метки.
	 */
	const synastryAspects = $derived(
		partnerRing
			? byPlanetOrder(
					findAspects(
						[...natalAspectBodies, ...angles],
						partnerRing.filter((p) => BODY_BY_ID[p.id].aspects)
					)
				)
			: []
	);

	// ── фильтр аспектов ─────────────────────────────────────────────
	/*
	 * По образцу фильтра точных транзитов: пресет «All» и ряд глифов, выбор
	 * одиночный.
	 *
	 * Натал — один ряд. Аспект двух своих планет симметричен: «Солнце секстиль
	 * Марс» — это аспект и Солнца, и Марса, поэтому планету ищем с любой
	 * стороны пары. Синастрия — два ряда, как «Transiting / To natal»: там
	 * стороны разные (моя планета → его планета), и их можно сочетать.
	 *
	 * Состояние у синастрии своё: переключаясь между режимами, фильтр одного
	 * не должен неожиданно сужать список другого.
	 */
	type AspectPick = 'all' | BodyId;
	let natalPick = $state<AspectPick>('all');
	let synFromPick = $state<AspectPick>('all');
	let synToPick = $state<AspectPick>('all');

	const natalAspectsShown = $derived(
		natalPick === 'all'
			? natalAspects
			: natalAspects.filter((a) => a.from.id === natalPick || a.to.id === natalPick)
	);
	const synastryAspectsShown = $derived(
		synastryAspects.filter(
			(a) =>
				(synFromPick === 'all' || a.from.id === synFromPick) &&
				(synToPick === 'all' || a.to.id === synToPick)
		)
	);
	/** Фильтр что-то выбрал — пустой список тогда объясняем иначе. */
	const aspectFilterActive = $derived(
		mode === 'synastry' ? synFromPick !== 'all' || synToPick !== 'all' : natalPick !== 'all'
	);

	/** Порядок как в таблице положений: по «от», внутри — по «к». */
	function byPlanetOrder(list: Aspect[]): Aspect[] {
		return list.sort(
			(a, b) => pointRank(a.from.id) - pointRank(b.from.id) || pointRank(a.to.id) - pointRank(b.to.id)
		);
	}

	/** Место точки в порядке списка: планеты как в BODIES, углы следом. */
	const POINT_ORDER: string[] = [...BODIES.map((b) => b.id), ...ANGLE_IDS];
	const pointRank = (id: string) => POINT_ORDER.indexOf(id);


	/**
	 * Натальная сетка: планеты между собой плюс планеты к углам.
	 *
	 * Углы подмешиваем вторым вызовом, а не в общий пул: в общем пуле нашлась
	 * бы и пары углов между собой: ASC–DSC и MC–IC всегда ровно 180°, а угол
	 * ASC–MC задан широтой места — это геометрия карты, а не аспекты.
	 */
	function natalGrid() {
		const pool = natalAspectBodies;
		return [...findAspects(pool, pool), ...findAspects(pool, angles)];
	}

	/** Орб в градусах и минутах: 2.23° → «2°14′». */
	function formatOrb(orb: number): string {
		const deg = Math.floor(orb);
		const min = Math.round((orb - deg) * 60);
		return min === 60 ? `${deg + 1}°00′` : `${deg}°${String(min).padStart(2, '0')}′`;
	}

	const aspects = $derived.by(() => {
		if (!chart) return [];
		/*
		 * Транзиты тоже смотрят на углы: список точных транзитов ищет аспекты к
		 * четырём углам, и без них клик по строке «Saturn square ASC» не подсветил
		 * бы на колесе ничего.
		 */
		const grid =
			mode === 'transits' && transits
				? findAspects(transits, [...natalAspectBodies, ...angles], transitOrb)
				: mode === 'synastry' && partnerRing
					? [...synastryAspects]
					: natalGrid();
		// склейка двух списков сбивает порядок — самые точные снова в конец,
		// чтобы на колесе их хорды лежали сверху
		return grid.sort((a, b) => b.orb - a.orb);
	});

	const rows = $derived(
		chart
			? chart.positions.map((p) => ({
					def: BODY_BY_ID[p.id],
					natal: p,
					transit: outer?.find((o) => o.id === p.id) ?? null
				}))
			: []
	);

	/**
	 * Дома для отдельного блока: куспид и планеты, попавшие в этот дом.
	 * Углы карты (I, IV, VII, X) помечаем — они читаются в первую очередь.
	 */
	const houseRows = $derived.by(() => {
		// в замыкание ниже chart попадает уже без null — иначе TypeScript
		// не может поручиться, что он не сменится между проверкой и вызовом
		const c = chart;
		if (!c) return [];
		/*
		 * В режиме транзитов дома заселяют транзитные планеты: куспиды всё равно
		 * натальные (рамка карты неподвижна), а смысл режима — что происходит
		 * сейчас. Натальную расстановку видно в режиме натала.
		 */
		// в синастрии дома заселяют планеты партнёра — по той же логике
		const occupants = outer ?? c.positions;
		return c.houses.cusps.map((cusp, i) => ({
			number: i + 1,
			roman: HOUSE_ROMAN[i],
			cusp: toZodiac(cusp),
			angle: i % 3 === 0,
			bodies: occupants.filter((p) => p.house === i + 1)
		}));
	});

	const rising = $derived(chart ? toZodiac(chart.houses.ascendant) : null);

	/** «12°05′ Leo» — позиция с коротким именем знака на текущем языке. */
	function position(longitude: number): string {
		const z = toZodiac(longitude);
		return `${z.degree}°${String(z.minute).padStart(2, '0')}′ ${t.signsShort[z.signIndex]}`;
	}

	/*
	 * Дата скраббера собирается вручную, а не через toLocaleDateString: русская
	 * локаль даёт «26 авг. 2026 г.» с точкой и «г.», а нам нужен один и тот же
	 * вид на обоих языках — «26 AUG 2026» / «26 АВГ 2026».
	 */
	const dateLabel = $derived(
		`${String(observation.getDate()).padStart(2, '0')} ${t.monthsShort[observation.getMonth()]} ${observation.getFullYear()}`
	);
</script>

<!--
	Выпадающая форма закрывается по Escape и по клику мимо — так ведут себя все
	всплывающие панели, и иначе она перекрывала бы карту, пока о ней не вспомнят.
	Слушаем именно pointerdown: к моменту click разметка внутри формы может уже
	смениться, и проверка «клик внутри» дала бы ложный промах.
-->
<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && showForm) showForm = false;
	}}
	onpointerdown={(e) => {
		if (!showForm) return;
		if (!birthNav?.contains(e.target as Node)) showForm = false;
	}}
/>

<div class="shell">
<nav class="nav" aria-label={t.settingsAria}>
	<!--
		Переключатель режима — левый край той же строки, что и настройки.
		Раньше здесь стояла подпись режима («Synastry»), а справа от имени —
		тяжёлый переключатель в рамке с залитой кнопкой: режим был назван
		дважды, и переключатель спорил с именем. Теперь подпись сама стала
		переключателем, в том же текстовом стиле, что «Day / Night» и
		«Mono / Elements».
	-->
	<div class="switch modes" role="group" aria-label={t.layerAria}>
		<button aria-pressed={mode === 'natal'} onclick={() => (mode = 'natal')}>{t.natal}</button>
		<button aria-pressed={mode === 'transits'} onclick={() => (mode = 'transits')}>
			{t.transits}
		</button>
		<button aria-pressed={mode === 'synastry'} onclick={() => (mode = 'synastry')}>
			{t.synastry}
		</button>
	</div>

	<div class="nav-groups">
	<div class="pref">
		<span>{t.theme}</span>
		<div class="switch" role="group" aria-label={t.theme}>
			<button aria-pressed={appearance.theme === 'light'} onclick={() => setTheme('light')}>
				{t.day}
			</button>
			<button aria-pressed={appearance.theme === 'dark'} onclick={() => setTheme('dark')}>
				{t.night}
			</button>
		</div>
	</div>
	<div class="pref">
		<span>{t.signsPalette}</span>
		<div class="switch" role="group" aria-label={t.signsPalette}>
			<button aria-pressed={appearance.palette === 'mono'} onclick={() => setPalette('mono')}>
				{t.mono}
			</button>
			<button
				aria-pressed={appearance.palette === 'elements'}
				onclick={() => setPalette('elements')}
			>
				{t.elements}
			</button>
		</div>
	</div>
	<!--
		Форма выпадает из кнопки: в шапке для неё нет места, а раскрывать её
		во всю ширину значило бы сдвигать вниз всю страницу при каждом открытии.
	-->
	<div class="birth" bind:this={birthNav}>
		<button
			class="disclose"
			aria-expanded={showForm}
			aria-controls="birth-form"
			onclick={() => (showForm = !showForm)}
		>
			{showForm ? t.close : t.birthData}
		</button>
		{#if showForm}
			<div class="birth-popover" id="birth-form">
				<BirthForm
					value={birth}
					onsubmit={(next) => {
						birth = next;
						showForm = false;
					}}
				/>
			</div>
		{/if}
	</div>
	</div>
</nav>

<header class="masthead">
	<div class="name-row">
		<h1 class="who">{birth.name}</h1>
	</div>

	<!--
		Строки о карте собраны из неразрывных кусков: на телефоне строка
		переносится только между ними, а не внутри — «ASC» больше не остаётся в
		конце строки без своего градуса. Точка-разделитель висит на конце куска,
		поэтому новая строка не начинается с «·».
	-->
	<div class="meta">
		{#if chart && rising}
			<span class="nowrap">{t.houseSystem} ·</span>
			<span class="nowrap">{t.rising(rising.signIndex)} ·</span>
			<span class="nowrap">ASC {position(chart.houses.ascendant)} ·</span>
			<span class="nowrap">MC {position(chart.houses.midheaven)}</span>
		{:else if error}
			{t.calcError}
		{:else}
			{t.computing}
		{/if}
	</div>
	<div class="meta origin">
		<span class="nowrap">{birth.place} ·</span>
		<span class="nowrap"
			>{formatDate(birth.date)} {birth.time} <span class="ampm">({to12Hour(birth.time)})</span> ·</span
		>
		<span class="nowrap">{birth.timezone}</span>
	</div>
</header>

<div class="rule"></div>

<div class="app">
	<section class="chart">
		<div class="stage" class:loading={!chart}>
			{#if chart}
				<Wheel
					houses={chart.houses}
					natal={chart.positions}
					transits={outer}
					{aspects}
					highlight={mode === 'transits' ? selectedHit : null}
					layer={mode}
				/>
			{/if}
		</div>

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</section>

	<section class="panel">
		<!--
			При смене режима содержимое панели проявляется заново целиком. Режимы
			переставляют почти всю панель: в синастрии сверху встают партнёр и
			аспекты, у Positions появляется колонка, внизу пропадают натальные
			аспекты. Проявлять только новые блоки мало — они сразу занимают место,
			и всё ниже всё равно прыгает. А пока панель прозрачна, перестановки не
			видно. Состояние (фильтры, свёрнутые секции) живёт в скрипте и не
			сбрасывается.
		-->
		{#key mode}
		<div class="panel-body" in:fade={{ duration: FADE }}>

		<div class="scrub" class:open={mode === 'transits'}>
			<div class="scrub-date">{dateLabel}</div>
			<div class="scrub-sub">{t.transitingPositions}</div>
			<input
				type="range"
				min="-180"
				max="180"
				step="1"
				bind:value={dayOffset}
				oninput={() => (selectedHit = null)}
				aria-label={t.scrubAria}
			/>
			<!--
				Возврат к сегодняшнему дню — это сама подпись TODAY под серединой шкалы,
				а не отдельная кнопка. Раньше внизу жила кнопка «back to today»: она
				была видна всегда, даже когда ползунок уже на сегодня, и дублировала
				эту подпись. Теперь клик по «today» ставит ползунок ровно туда, где
				на шкале сегодняшний день. На сегодня кнопка выключена и выглядит
				обычной подписью — нажимать её незачем.
			-->
			<div class="scrub-ends">
				<span>{t.minus6mo}</span>
				<button
					class="today"
					disabled={isToday}
					aria-label={t.backToToday}
					title={isToday ? undefined : t.backToToday}
					onclick={() => {
						dayOffset = 0;
						selectedHit = null;
					}}>{t.today}</button
				>
				<span>{t.plus6mo}</span>
			</div>
		</div>

		{#if mode === 'transits'}
			<section class="exact">
				<header>
					<button
						class="fold"
						aria-expanded={exactOpen}
						aria-controls="exact-body"
						onclick={() => (exactOpen = !exactOpen)}
					>
						<!--
							Шеврон рисуем вектором, а не символом ▾: типографский треугольник
							в 9px превращается в точку и зависит от шрифта.
						-->
						<svg class="chevron" class:closed={!exactOpen} viewBox="0 0 10 6" aria-hidden="true">
							<path d="M1 5 L5 1 L9 5" />
						</svg>
						{t.exactTransits}
					</button>
				</header>

				<div id="exact-body" hidden={!exactOpen}>
				<!--
					Два фильтра — две стороны аспекта, каждый со своей подписью: без неё
					два одинаковых ряда глифов не отличить. Подписи сделаны как заголовки
					колонок в таблицах, пресеты стоят в той же строке справа — так видно,
					к какому ряду они относятся («Slow/All» — про движущиеся планеты,
					«Any» — про натальные точки).
				-->
				<div class="filter-head">
					<span class="filter-cap">{t.exactFromLabel}</span>
					<div class="switch" role="group" aria-label={t.exactFilterAria}>
						<button aria-pressed={exactFrom === 'slow'} onclick={() => (exactFrom = 'slow')}>
							{t.exactSlow}
						</button>
						<button aria-pressed={exactFrom === 'all'} onclick={() => (exactFrom = 'all')}>
							{t.exactAll}
						</button>
					</div>
				</div>
				<div class="exact-filter" role="group" aria-label={t.exactFilterAria}>
					{#each EXACT_FILTER_BODIES as body (body.id)}
						<!-- глиф без подписи, поэтому имя планеты — в aria-label и во всплывающей подсказке -->
						<button
							class="planet"
							aria-pressed={exactFrom === body.id}
							aria-label={t.bodies[body.id]}
							title={t.bodies[body.id]}
							onclick={() => (exactFrom = body.id)}>{body.glyph}</button
						>
					{/each}
				</div>

				<div class="filter-head">
					<span class="filter-cap">{t.exactToLabel}</span>
					<div class="switch" role="group" aria-label={t.exactTargetFilterAria}>
						<button aria-pressed={exactTo === 'any'} onclick={() => (exactTo = 'any')}>
							{t.exactAny}
						</button>
					</div>
				</div>
				<div class="exact-filter" role="group" aria-label={t.exactTargetFilterAria}>
					{#each NATAL_TARGET_BODIES as body (body.id)}
						<button
							class="planet"
							aria-pressed={exactTo === body.id}
							aria-label={t.natalOf(t.bodies[body.id])}
							title={t.natalOf(t.bodies[body.id])}
							onclick={() => selectTarget(body.id)}>{body.glyph}</button
						>
					{/each}
				</div>

				<!--
					Пока идёт поиск, место под список держим его полной высоты. Раньше
					здесь была одна строка «Searching…», а потом появлялся список в
					~270px — всё ниже (Positions, Houses) резко уезжало вниз, и сам
					список возникал рывком. Теперь высота не меняется, а список
					проявляется.
				-->
				{#if exactHits === null}
					<div class="exact-wait">
						<p class="exact-note">{t.exactSearching}</p>
					</div>
				{:else if exactHits.length === 0}
					<p class="exact-note">{exactEmptyNote}</p>
				{:else}
					<ol bind:this={exactList} in:fade={{ duration: FADE }}>
						{#each exactHits as hit, i (hit.transitId + hit.aspectId + hit.targetId + hit.jd)}
							<li
								class:past={hit.date < today}
								class:next={i === nextIndex}
								class:active={exactMoment?.getTime() === hit.date.getTime()}
							>
								<button onclick={() => showExact(hit)}>
									<span class="when">
										{shortDate(hit.date)}
										<small>{shortTime(hit.date)}</small>
									</span>
									<span class="glyphs">
										{BODY_BY_ID[hit.transitId].glyph}{#if hit.retrograde}<span class="rx">℞</span>{/if}
										<span class="asp {hit.aspectId}">{ASPECT_GLYPH[hit.aspectId]}</span>
										<span class:angle-name={hit.targetId in ANGLE_LABEL}
											>{targetGlyph(hit.targetId)}</span
										>
									</span>
									<span
										class="what"
										title="{t.bodies[hit.transitId]} {t.aspectVerbs[hit.aspectId]} {targetName(
											hit.targetId
										)}"
									>
										{t.bodies[hit.transitId]}
										{t.aspectVerbs[hit.aspectId]}
										{targetName(hit.targetId)}
									</span>
								</button>
							</li>
						{/each}
					</ol>
					<p class="exact-note">{t.exactHint}</p>
					{#if exactFrom === 'moon'}
						<p class="exact-note">{t.exactMoonWindow}</p>
					{/if}
				{/if}
				</div>
			</section>
		{/if}

		{#if mode === 'synastry'}
			<!--
				Партнёр — наверху панели, на месте даты и шкалы транзитов: это та же
				роль, «с чем сравниваем». Пока партнёра нет — форма; потом она
				сворачивается в имя и строку данных с «edit».
			-->
			<section class="partner">
				<div class="partner-cap">{t.partner}</div>
				{#if showPartnerForm}
					<BirthForm
						value={partner ?? EMPTY_PARTNER}
						submitLabel={t.compare}
						onsubmit={(next) => {
							partner = next;
							partnerEditing = false;
						}}
					/>
					{#if partner}
						<button class="partner-link" onclick={() => (partnerEditing = false)}>
							{t.partnerCancel}
						</button>
					{/if}
				{:else if partner}
					<div class="partner-name">{partner.name}</div>
					<div class="partner-meta">
						<!-- город необязателен: координаты можно ввести руками -->
						{formatDate(partner.date)}
						{partner.time}{#if partner.place.trim()}&nbsp;· {partner.place}{/if}
					</div>
					<button class="partner-link" onclick={() => (partnerEditing = true)}>
						{t.partnerEdit}
					</button>
				{/if}
			</section>

			<!-- в синастрии аспекты между картами — главное, поэтому они первыми -->
			{#if partner && partnerRing}
				{@render aspectsBlock(synastryAspectsShown, t.noSynastryAspects)}
			{/if}
		{/if}

		<section class="positions">
			<header>
				<button
					class="fold"
					aria-expanded={positionsOpen}
					aria-controls="positions-body"
					onclick={() => (positionsOpen = !positionsOpen)}
				>
					<svg class="chevron" class:closed={!positionsOpen} viewBox="0 0 10 6" aria-hidden="true">
						<path d="M1 5 L5 1 L9 5" />
					</svg>
					{t.positions}
				</button>
			</header>

		<table class="list" id="positions-body" hidden={!positionsOpen}>
			<thead>
				<tr>
					<th colspan="2">{t.planet}</th>
					<!-- в синастрии колонки подписаны именами: «натал» там у обоих -->
					<th class="num">{mode === 'synastry' && partner ? birth.name : t.natalColumn}</th>
					{#if mode === 'transits'}<th class="num">{t.transitColumn}</th>{/if}
					{#if mode === 'synastry' && partnerRing && partner}<th class="num">{partner.name}</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.def.id)}
					<tr>
						<td class="g">{row.def.glyph}</td>
						<td class="nm">{t.bodies[row.def.id]}</td>
						<!--
							Градус и знак — каждый в своей колонке фиксированной ширины.
							Одним правым выключением знаки вставали каждый на своё место
							(«Tau», «Aqu», «Sco ℞»), и колонка выглядела рваной. ℞ — индекс
							вплотную к знаку, внутри его колонки: колонка знака шире самого
							знака как раз на ℞, поэтому знаки стоят ровно и с ним, и без.
						-->
						<td class="pos">
							<span class="posline">
								<span class="deg">{toZodiac(row.natal.longitude).degree}°</span>
								<span class="sign"
									>{t.signsShort[toZodiac(row.natal.longitude).signIndex]}{#if row.natal.retrograde}<span
											class="rx">℞</span
										>{/if}</span
								>
							</span>
						</td>
						{#if mode === 'transits' || (mode === 'synastry' && partnerRing)}
							<td class="pos">
								<span class="posline">
									<!--
										Три состояния, а не два. Пока транзиты (или карта партнёра) ещё
										считаются, ячейка пустая: раньше на эту долю секунды во всех
										строках вставал прочерк, и колонка мигала «— → значения».
										Прочерк — только когда тела на внешнем кольце нет совсем
										(узлы, Хирон). Значения проявляются; на шагах ползунка блок
										{#if} не пересоздаётся, и они не мигают.
									-->
									{#if row.transit}
										<span class="deg" in:fade={{ duration: FADE }}
											>{toZodiac(row.transit.longitude).degree}°</span
										>
										<span class="sign" in:fade={{ duration: FADE }}
											>{t.signsShort[toZodiac(row.transit.longitude).signIndex]}{#if row.transit.retrograde}<span
													class="rx">℞</span
												>{/if}</span
										>
									{:else if outer}
										<span class="deg none" in:fade={{ duration: FADE }}>—</span>
									{/if}
								</span>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
		</section>

		<section class="houses-block">
			<header>
				<button
					class="fold"
					aria-expanded={housesOpen}
					aria-controls="houses-body"
					onclick={() => (housesOpen = !housesOpen)}
				>
					<svg class="chevron" class:closed={!housesOpen} viewBox="0 0 10 6" aria-hidden="true">
						<path d="M1 5 L5 1 L9 5" />
					</svg>
					{t.houses}
				</button>
			</header>

			<table class="list houses" id="houses-body" hidden={!housesOpen}>
				<thead>
					<tr>
						<th>{t.house}</th>
						<th class="num">{t.cusp}</th>
						<!-- подпись меняется вместе с содержимым: иначе непонятно, чьи это планеты -->
						<th class="num">
							{mode === 'transits'
								? t.transiting
								: mode === 'synastry' && partnerRing && partner
									? partner.name
									: t.inHouse}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each houseRows as h (h.number)}
						<tr>
							<td class="hnum" class:angle={h.angle}>{h.roman}</td>
							<td class="pos">
								<span class="posline">
									<span class="deg">{h.cusp.degree}°</span>
									<span class="sign">{t.signsShort[h.cusp.signIndex]}</span>
								</span>
							</td>
							<!-- глифы планет, попавших в дом; пусто — значит дом без планет -->
							<td class="occupants">
								{#each h.bodies as b (b.id)}<span class="g">{BODY_BY_ID[b.id].glyph}</span>{/each}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<!--
			Только в натале. В режиме транзитов на колесе лежит сетка транзит →
			натал, и вторая таблица про саму карту рядом с ней сбивает с толку.
			В синастрии тот же блок стоит выше, со списком аспектов между картами.
		-->
		{#if mode === 'natal'}
			{@render aspectsBlock(natalAspectsShown, t.noAspects)}
		{/if}

		<!--
			Ряд фильтра: подпись и пресет «All» в одной строке, под ними глифы —
			ровно как у точных транзитов, те же классы и тот же вид.
		-->
		{#snippet pickRow(label: string, value: AspectPick, pick: (id: AspectPick) => void)}
			<div class="filter-head">
				<span class="filter-cap">{label}</span>
				<div class="switch" role="group" aria-label={t.aspectFilterAria}>
					<button aria-pressed={value === 'all'} onclick={() => pick('all')}>{t.exactAll}</button>
				</div>
			</div>
			<div class="exact-filter" role="group" aria-label={t.aspectFilterAria}>
				{#each NATAL_TARGET_BODIES as body (body.id)}
					<button
						class="planet"
						aria-pressed={value === body.id}
						aria-label={t.bodies[body.id]}
						title={t.bodies[body.id]}
						onclick={() => pick(body.id)}>{body.glyph}</button
					>
				{/each}
			</div>
		{/snippet}

		{#snippet aspectsBlock(list: Aspect[], emptyNote: string)}
		<section class="aspects-block">
			<header>
				<button
					class="fold"
					aria-expanded={aspectsOpen}
					aria-controls="aspects-body"
					onclick={() => (aspectsOpen = !aspectsOpen)}
				>
					<svg class="chevron" class:closed={!aspectsOpen} viewBox="0 0 10 6" aria-hidden="true">
						<path d="M1 5 L5 1 L9 5" />
					</svg>
					{t.aspects}
				</button>
			</header>

			<div id="aspects-body" hidden={!aspectsOpen}>
				{#if mode === 'synastry' && partner}
					{@render pickRow(birth.name, synFromPick, (id) => (synFromPick = id))}
					{@render pickRow(partner.name, synToPick, (id) => (synToPick = id))}
				{:else}
					{@render pickRow(t.aspectPlanetLabel, natalPick, (id) => (natalPick = id))}
				{/if}

				{#if list.length === 0}
					<p class="exact-note">{aspectFilterActive ? t.noAspectsFiltered : emptyNote}</p>
				{:else}
					<table class="list aspects">
						<!--
							Строки заголовка у таблицы нет, хотя раньше была: в ней стояло
							только «ORB» (в синастрии ещё «Poli → Alex»), и под фильтром
							висела почти пустая строка — ~40px воздуха и одинокое слово.
							Имена уже подписаны у рядов фильтра, а что за число справа,
							говорит подсказка при наведении.
						-->
						<tbody>
							{#each list as a (a.from.id + a.def.id + a.to.id)}
								<tr>
									<td class="pair">
										<span class:angle-name={a.from.id in ANGLE_LABEL}>{targetGlyph(a.from.id)}</span
										><span class="asp {a.def.id}">{a.def.glyph}</span
										><span class:angle-name={a.to.id in ANGLE_LABEL}>{targetGlyph(a.to.id)}</span>
									</td>
									<td class="nm">
										{targetName(a.from.id)}
										{t.aspectVerbs[a.def.id]}
										{targetName(a.to.id)}
									</td>
									<td class="orb" title={t.orb}>{formatOrb(a.orb)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</section>
		{/snippet}

		</div>
		{/key}
	</section>
</div>

<!--
	Подвал во всю ширину, за такой же линией, как под шапкой: закрывает всю
	страницу, а не висит в конце одной колонки, как прежняя сноска под панелью.
	Ссылки на исходники (её требует AGPL для публичного сайта) пока нет —
	появится вместе с репозиторием.
-->
<footer class="site-foot">
	<div class="rule"></div>
	<p>
		{t.footerEngine}
		{t.footerPrivacy} <span class="nowrap">{t.footerGeocoder}.</span>
	</p>
	<!-- точка-разделитель висит на конце пункта, поэтому новая строка
	     никогда не начинается с «·» -->
	<p class="method">
		{#each t.footerMethod as item, i (item)}<span class="nowrap"
				>{item}{i < t.footerMethod.length - 1 ? ' ·' : ''}</span
			>{' '}{/each}
	</p>
	<p class="author">{t.footerAuthor}</p>
</footer>
</div>

<style>
	/*
	 * Одна сетка полей на всю страницу: шапка, заголовок и колонки раньше
	 * задавали max-width и отступы каждый по-своему и не сходились по краям.
	 */
	.shell {
		width: 100%;
		max-width: 1160px;
		margin: 0 auto;
		padding: 24px 20px 64px;
	}

	.app {
		display: grid;
		grid-template-columns: 1fr;
		gap: 36px;
	}
	@media (min-width: 900px) {
		.app {
			/*
			 * Панели хватает фиксированной ширины: там короткие строки таблицы, и
			 * растягивать её значит гнать глаз через пустоту. Всё лишнее место
			 * забирает колесо — ради него страницу и расширили.
			 */
			grid-template-columns: minmax(0, 1fr) clamp(340px, 30%, 430px);
			align-items: start;
			gap: 56px;
		}
	}

	/* заголовок карты во всю ширину: имя слева, переключатель слоя справа */
	/* заголовок идёт вплотную за шапкой: они читаются одним блоком */
	/*
	 * Отступ от строки навигации до имени. Раньше над именем стояла подпись
	 * режима — она относилась к имени, и плотная посадка была уместна. Теперь
	 * там навигация, и имя должно начинаться отдельным блоком, а не читаться
	 * её продолжением.
	 */
	.masthead {
		margin-top: 28px;
	}
	/* тот же кегль и трекинг, что у настроек, — строка читается одной полосой */
	.name-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px 28px;
		margin: 0 0 12px;
	}
	.who {
		font-family: var(--serif);
		font-size: clamp(30px, 5vw, 46px);
		line-height: 1.02;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	.meta {
		font-size: 12px;
		letter-spacing: 0.12em;
		color: var(--ink-dim);
		text-transform: uppercase;
	}
	/* откуда карта — чтобы смена города была видна сразу, а не только в колесе */
	.meta.origin {
		color: var(--ink-faint);
		margin-top: 6px;
	}
	.meta .ampm {
		text-transform: none;
		letter-spacing: 0.04em;
	}
	.rule {
		height: 1px;
		background: var(--ink-faint);
		margin: 28px 0;
	}

	.stage {
		position: relative;
		width: 100%;
		/* предел, чтобы на широком мониторе колесо не разрасталось до абсурда */
		max-width: 680px;
		margin: 0 auto;
		transition: opacity 0.4s ease;
	}
	/* пока эфемериды грузятся, держим место колеса — чтобы страница не прыгала */
	.stage.loading {
		aspect-ratio: 1;
		opacity: 0;
	}

	.error {
		font-size: 12px;
		line-height: 1.6;
		color: var(--ink-dim);
		margin-top: 18px;
	}

	.panel {
		padding-top: 4px;
	}


	.scrub {
		overflow: hidden;
		max-height: 0;
		opacity: 0;
		transition:
			max-height 0.45s ease,
			opacity 0.35s ease;
	}
	.scrub.open {
		max-height: 200px;
		opacity: 1;
	}
	.scrub-date {
		font-family: var(--serif);
		font-size: 26px;
		letter-spacing: 0.02em;
		margin-bottom: 4px;
	}
	.scrub-sub {
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-dim);
		margin-bottom: 18px;
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 1px;
		background: var(--ink-faint);
		margin: 6px 0 8px;
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--ink);
		cursor: pointer;
		margin-top: -1px;
	}
	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 50%;
		background: var(--ink);
		cursor: pointer;
	}
	.scrub-ends {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
		text-transform: uppercase;
	}
	/*
	 * «today» под шкалой — подпись и кнопка одновременно. Кегль и трекинг
	 * берёт от соседей (-6 MO / +6 MO), чтобы строка оставалась одной.
	 * На сегодня — такая же тихая, как соседи; в другой дате — ярче, при
	 * наведении подчёркивается: видно, что по ней можно вернуться.
	 */
	.today {
		appearance: none;
		background: none;
		border: 0;
		border-bottom: 1px solid transparent;
		padding: 0 0 1px;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		color: var(--ink-dim);
		cursor: pointer;
		transition:
			color 0.2s,
			border-color 0.2s;
	}
	.today:hover {
		color: var(--ink);
		border-bottom-color: var(--ink-faint);
	}
	.today:disabled {
		color: inherit;
		cursor: default;
		border-bottom-color: transparent;
	}

	/* ── точные транзиты ── */
	/*
	 * Отступ между секциями панели разделён на две части:
	 *   10px над заголовком — есть всегда;
	 *   20px под содержимым — только у раскрытой секции.
	 * У раскрытой в сумме те же 30px, что и раньше. У свёрнутой содержимого
	 * нет (hidden = display: none), и его 16px уходят вместе с ним — свёрнутые
	 * заголовки стоят плотной стопкой, а воздух принадлежит раскрытому блоку.
	 * 10px подобраны так, чтобы шаг свёрнутых заголовков (~38px) совпал с
	 * высотой строки таблиц (39px) — стопка читается как такой же список.
	 */
	.exact,
	.positions,
	.houses-block,
	.aspects-block {
		margin-top: 10px;
		/*
		 * flow-root держит хвост содержимого внутри секции. Без него отступы
		 * схлопываются: 20px под содержимым и 10px над следующим заголовком
		 * дают не 30px, а 20 — больший из двух.
		 */
		display: flow-root;
	}
	#exact-body,
	#positions-body,
	#houses-body,
	#aspects-body {
		margin-bottom: 20px;
	}
	/* дата со шкалой — не сворачиваемая секция, своего хвоста у неё нет */
	.scrub + .exact {
		margin-top: 30px;
	}
	.exact header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}
	/* заголовок-кнопка: сворачивает секцию, выглядит как обычный микро-заголовок */
	.fold {
		appearance: none;
		background: none;
		border: 0;
		padding: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
		cursor: pointer;
		transition: color 0.2s;
	}
	.fold:hover {
		color: var(--ink-dim);
	}
	/* открытая секция — шеврон вверх («свернуть»), закрытая — вниз («развернуть») */
	.chevron {
		width: 10px;
		height: 6px;
		overflow: visible;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		/*
		 * У SVG точка отсчёта для transform по умолчанию — левый верхний угол
		 * системы координат, а не центр фигуры: без fill-box шеврон при повороте
		 * уезжал бы вбок.
		 */
		transform-box: fill-box;
		transform-origin: center;
		transition: transform 0.25s ease;
	}
	.chevron.closed {
		transform: rotate(180deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	/*
	 * В режиме натала «Положения» открывают панель, и отступ сверху не нужен:
	 * иначе они начинаются ниже, чем дата в режиме транзитов.
	 *
	 * Проверять на :first-child нельзя — первым в панели всегда стоит блок
	 * скраббера. В натале он свёрнут в нулевую высоту, но из разметки никуда не
	 * девается, поэтому ловим его в свёрнутом виде через соседний селектор.
	 */
	.scrub:not(.open) + .positions,
	.scrub:not(.open) + .partner {
		margin-top: 0;
	}

	/*
	 * Блок партнёра — по образцу даты и шкалы транзитов: крупное имя тем же
	 * шрифтом, что дата, строка данных под ним мелким капсом. Хвост 20px —
	 * тот же, что у раскрытых секций, чтобы расстояние до «Aspects» было как
	 * между секциями.
	 */
	.partner {
		display: flow-root;
		padding-bottom: 20px;
	}
	.partner-cap {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin-bottom: 8px;
	}
	.partner-name {
		font-family: var(--serif);
		font-size: 26px;
		letter-spacing: 0.02em;
		margin-bottom: 4px;
	}
	.partner-meta {
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-dim);
	}
	.partner-link {
		appearance: none;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--ink-faint);
		padding: 0 0 2px;
		margin-top: 14px;
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-dim);
		cursor: pointer;
	}
	.partner-link:hover {
		color: var(--ink);
	}
	/*
	 * Заголовки колонок положений («Natal», «Transit», имена в синастрии)
	 * встают над знаком, а не над местом под ℞. Колонка знака шире самого
	 * знака на запас под ℞ (~22px), и заголовок, прижатый к краю ячейки,
	 * висел правее градусов. 21px = запас минус хвост трекинга у заголовка.
	 */
	#positions-body th.num {
		padding-right: 21px;
	}
	/* прочерк «нет транзита» (узлы, Хирон) — под знаком, как и заголовок */
	#positions-body .deg.none {
		padding-right: 22px;
	}
	.positions header {
		margin-bottom: 4px;
	}
	/*
	 * Подпись ряда фильтра — тот же микро-заголовок, что у колонок таблиц
	 * («PLANET», «NATAL»), пресеты в той же строке справа.
	 */
	.filter-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 4px;
	}
	/* второй фильтр отбит от первого — это другая сторона аспекта */
	.exact-filter + .filter-head {
		margin-top: 14px;
	}
	.filter-cap {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	/* у последней кнопки пресетов правый отступ не нужен — прижимаем к краю */
	.filter-head .switch button:last-child {
		margin-right: 0;
	}
	.exact-filter {
		display: flex;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	/*
	 * Выбранную планету отличает только плотность: глиф в полную силу чернил,
	 * остальные приглушены. Ни рамки, ни подчёркивания — у глифов нет общей
	 * базовой линии и одинаковой высоты, поэтому любая линия под ними сразу
	 * показывает, что символы стоят по-разному.
	 */
	.exact-filter button {
		appearance: none;
		background: none;
		border: 0;
		color: var(--ink-faint);
		cursor: pointer;
		transition: color 0.2s;
	}
	.exact-filter button:hover {
		color: var(--ink-dim);
	}
	.exact-filter button[aria-pressed='true'] {
		color: var(--ink);
	}
	/*
	 * Ширина фиксированная, чтобы ряд не прыгал при смене выбора, а сам глиф
	 * центрируется сеткой: у place-items середина считается по строке целиком,
	 * а не по базовой линии.
	 */
	.exact-filter .planet {
		font-family: var(--glyph);
		font-size: 16px;
		width: 30px;
		height: 26px;
		display: grid;
		place-items: center;
		padding: 0;
		line-height: 1;
	}

	/*
	 * Та же высота, что у списка вместе с подсказкой под ним: 268px списка +
	 * две линии по 1px + 18px подсказки «Click a row…» (6px отступа и строка).
	 */
	.exact-wait {
		min-height: 288px;
	}
	.exact-wait .exact-note {
		margin-top: 0;
		padding-top: 14px;
	}
	.exact ol {
		list-style: none;
		margin: 0;
		padding: 0;
		/* около семи строк; остальное прокруткой, чтобы таблица не уезжала вниз */
		max-height: 268px;
		overflow-y: auto;
		position: relative;
		border-top: 1px solid var(--ink-ghost);
		border-bottom: 1px solid var(--ink-ghost);
	}
	.exact li + li {
		border-top: 1px solid var(--ink-ghost);
	}
	.exact li button {
		appearance: none;
		background: none;
		border: 0;
		width: 100%;
		display: grid;
		grid-template-columns: 7.2em 4.6em 1fr;
		align-items: baseline;
		gap: 10px;
		/*
		 * Слева больше поля: у выбранной строки там метка-линия, и дата не должна
		 * к ней прилипать. Отступ одинаковый у всех строк, иначе при выборе
		 * содержимое дёргалось бы вбок.
		 */
		padding: 9px 6px 9px 10px;
		/*
		 * Единая высота строки. Без неё строка с переносом подписи оказывается
		 * выше соседних, и список идёт рваной лесенкой.
		 */
		min-height: 52px;
		text-align: left;
		cursor: pointer;
		font-size: 12.5px;
		transition: background 0.2s;
	}
	.exact li button:hover {
		background: var(--hover);
	}
	/* прошедшие приглушены, ближайший впереди отмечен, выбранный — выделен */
	.exact li.past button {
		opacity: 0.45;
	}
	.exact li.next .when {
		color: var(--ink);
	}
	.exact li.active button {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--ink);
		opacity: 1;
	}
	.exact .when {
		font-family: var(--serif);
		font-size: 13px;
		color: var(--ink-dim);
		white-space: nowrap;
	}
	.exact .when small {
		display: block;
		font-family: var(--grot);
		font-size: 10px;
		color: var(--ink-faint);
		letter-spacing: 0.06em;
	}
	.exact .glyphs {
		font-family: var(--glyph);
		font-size: 15px;
		white-space: nowrap;
	}
	/*
	 * ℞ — мелким индексом, как градус у глифа на колесе. Полным кеглем строка
	 * «☿℞ □ ASC» не помещалась в колонку и подходила вплотную к подписи.
	 */
	.exact .rx {
		font-size: 9px;
		margin-left: 1px;
	}
	.exact .asp {
		font-size: 12px;
		color: var(--ink-dim);
		margin: 0 1px;
	}
	/* цвет значка аспекта — тот же, что на колесе в палитре «стихии» */
	:global(:root[data-palette='elements']) .exact .asp.square,
	:global(:root[data-palette='elements']) .exact .asp.opposition {
		color: var(--aspect-hard);
	}
	:global(:root[data-palette='elements']) .exact .asp.trine {
		color: var(--aspect-trine);
	}
	:global(:root[data-palette='elements']) .exact .asp.sextile {
		color: var(--aspect-sextile);
	}
	/*
	 * Подпись в одну строку. Самая длинная пара — «Mercury opposite Neptune»,
	 * 24 знака. У моноширинного ширина знака 0.6em, при 10.5px это 151px —
	 * колонка не уже 161px даже на самой узкой панели, запас есть.
	 * Межбуквенный интервал убран: он добавлял ещё 5px и подписи не влезали.
	 * Обрезка с многоточием оставлена страховкой, полный текст — в подсказке.
	 */
	.exact .what {
		color: var(--ink-dim);
		font-size: 10.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.exact-note {
		font-size: 10px;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		margin-top: 14px;
	}
	/*
	 * Подсказка под списком — на том же расстоянии от линии, что «9:20 PM» под
	 * полем времени в форме рождения (6px): подпись к тому, что над ней, а не
	 * отдельный абзац. Остальные примечания («Searching…», пустой список)
	 * стоят под фильтром и сохраняют обычную отбивку.
	 */
	.exact ol + .exact-note {
		margin-top: 6px;
	}
	/* второе примечание идёт следом — между ними отбивка меньше */
	.exact-note + .exact-note {
		margin-top: 3px;
	}

	.aspects-block header {
		margin-bottom: 4px;
	}
	/* кегли те же, что в «Положениях», — три таблицы читаются одним масштабом */
	.list.aspects .pair {
		width: 4.6em;
		font-family: var(--glyph);
		font-size: 16px;
		white-space: nowrap;
	}
	.list.aspects .pair .asp {
		font-size: 12px;
		color: var(--ink-dim);
		margin: 0 3px;
		transition: color 0.35s ease;
	}
	/* тот же цвет по типу, что у значков на колесе и в списке точных транзитов */
	:global(:root[data-palette='elements']) .list.aspects .asp.square,
	:global(:root[data-palette='elements']) .list.aspects .asp.opposition {
		color: var(--aspect-hard);
	}
	:global(:root[data-palette='elements']) .list.aspects .asp.trine {
		color: var(--aspect-trine);
	}
	:global(:root[data-palette='elements']) .list.aspects .asp.sextile {
		color: var(--aspect-sextile);
	}
	/*
	 * У угла нет глифа, вместо него стоит «ASC» / «MC» буквами. Шрифтом глифов
	 * и в их кегле буквы вылезают крупнее соседей, поэтому — текстовый шрифт
	 * помельче, как подписи углов на колесе.
	 */
	.list.aspects .pair .angle-name,
	.exact .glyphs .angle-name {
		font-family: var(--grot);
		font-size: 10px;
		letter-spacing: 0.08em;
	}
	.list.aspects .nm {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* орб — вспомогательная величина: тише текста и цифрами одной ширины */
	.list.aspects .orb {
		width: 4.4em;
		text-align: right;
		font-size: 11px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	/*
	 * У куспида ℞ не бывает, поэтому место под него в колонке знака не нужно.
	 * С ним справа от «Aqu» оставалась пустота, и градус со знаком стояли левее
	 * заголовка «CUSP», прижатого к правому краю, — колонка не читалась как одна.
	 */
	/*
	 * Ширина — ровно по знаку: шрифт моноширинный и знаки все из трёх букв,
	 * так что колонка остаётся ровной без запаса.
	 */
	.list.houses .posline {
		grid-template-columns: 2.3em max-content;
	}
	.houses-block header {
		margin-bottom: 4px;
	}
	/* номер дома: у углов карты плотнее — с них начинают читать */
	.list.houses .hnum {
		width: 3em;
		font-size: 11px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.list.houses .hnum.angle {
		color: var(--ink-dim);
	}
	.list.houses .occupants {
		text-align: right;
		font-family: var(--glyph);
		font-size: 14px;
		color: var(--ink);
		white-space: nowrap;
	}
	.list.houses .occupants .g {
		margin-left: 5px;
	}

	.list {
		width: 100%;
		border-collapse: collapse;
	}
	.list th {
		text-align: left;
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
		font-weight: 400;
		padding: 0 0 12px;
	}
	.list th.num {
		text-align: right;
	}
	/* одна высота строки во всех трёх таблицах, независимо от кегля содержимого */
	.list tbody tr {
		height: 39px;
	}
	.list td {
		padding: 9px 0;
		border-top: 1px solid var(--ink-ghost);
		font-size: 13px;
		vertical-align: middle;
	}
	.list .g {
		font-family: var(--glyph);
		font-size: 16px;
		width: 26px;
	}
	.list .nm {
		color: var(--ink-dim);
		letter-spacing: 0.02em;
		/* имена не переносятся: строка с переносом выше соседних */
		white-space: nowrap;
	}
	/*
	 * Позиция — сетка из трёх колонок: градус прижат вправо, знак начинается от
	 * общей левой границы, ℞ занимает свою клетку всегда. Так градусы, знаки и
	 * пометки ретроградности выстраиваются по вертикали через всю таблицу.
	 *
	 * Сетка лежит ВНУТРИ ячейки, а не на ней: display: grid у <td> отменяет его
	 * роль ячейки, он выпадает из строки таблицы и встаёт отдельным блоком —
	 * натальная и транзитная позиции оказывались друг под другом.
	 */
	.list .pos {
		text-align: right;
		white-space: nowrap;
	}
	.list .posline {
		display: inline-grid;
		/*
		 * Колонка знака вмещает и ℞ — он приклеен к знаку, а не стоит отдельной
		 * колонкой. Ширина та же, что была у знака + ℞ + зазора между ними,
		 * поэтому таблицы Positions и Houses не сдвинулись.
		 */
		grid-template-columns: 2.3em calc(3.1em + 4px);
		align-items: baseline;
		gap: 4px;
		text-align: left;
	}
	.list .deg {
		font-family: var(--serif);
		font-size: 15px;
		text-align: right;
		/* цифры одной ширины — иначе «1°» и «13°» не встают друг под друга */
		font-variant-numeric: tabular-nums;
	}
	.list .deg.none {
		grid-column: 1 / -1;
		color: var(--ink-faint);
	}
	.list .sign {
		color: var(--ink-dim);
		font-size: 11px;
		letter-spacing: 0.05em;
	}
	/*
	 * ℞ — мелким индексом рядом со знаком. Отступ больше, чем в списке точных
	 * транзитов (там 1px после глифа): у знака буквы, и при 1px «Sco℞»
	 * слипалось в одно слово.
	 */
	.list .rx {
		font-size: 9px;
		margin-left: 12px;
	}

	/* шапка: настройки и данные рождения прижаты вправо, над колесом */
	/* шапка: подпись карты слева, настройки справа, всё по базовой линии */
	.nav {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px 28px;
	}
	/*
	 * Внутри группы — по левому краю. На широком экране это ни на что не
	 * влияет: группа целиком прижата вправо самой строкой навигации. А на
	 * телефоне она переносится под переключатель режимов, и при flex-end
	 * строки прижимались вправо лесенкой: «Theme / Signs» с отступом, «Birth
	 * data» отдельно у правого края. Слева они встают ровно под «Natal».
	 */
	.nav-groups {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-start;
		gap: 12px 26px;
	}
	.pref {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.pref > span {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.switch {
		display: inline-flex;
		gap: 2px;
	}
	.switch button {
		appearance: none;
		background: none;
		border: 0;
		border-bottom: 1px solid transparent;
		color: var(--ink-faint);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 2px 0;
		margin-right: 10px;
		cursor: pointer;
		transition: 0.25s;
	}
	.switch button:hover {
		color: var(--ink-dim);
	}
	.switch button[aria-pressed='true'] {
		color: var(--ink);
		border-bottom-color: var(--ink-faint);
	}
	/*
	 * Режим — главная навигация экрана, поэтому трекинг тот же, что был у
	 * подписи на этом месте (0.2em), и тон чуть плотнее, чем у настроек.
	 * Стиль при этом общий — слова капсом, активное подчёркнуто.
	 */
	.switch.modes button {
		letter-spacing: 0.2em;
		color: var(--ink-dim);
		margin-right: 16px;
	}
	.switch.modes button:hover,
	.switch.modes button[aria-pressed='true'] {
		color: var(--ink);
	}

	/* якорь для выпадающей формы */
	.birth {
		position: relative;
	}
	.birth-popover {
		position: absolute;
		top: calc(100% + 12px);
		right: 0;
		z-index: 5;
		width: min(420px, calc(100vw - 40px));
		padding: 4px 18px 18px;
		background: var(--bg);
		border: 1px solid var(--ink-faint);
		/* на маленьких экранах форма выше окна — пусть прокручивается сама */
		max-height: min(70vh, 560px);
		overflow-y: auto;
	}
	/*
	 * На телефоне «Birth data» переносится к левому краю, и форма, привязанная
	 * к правому краю кнопки, открывалась бы за экран влево. Там привязываем её
	 * к левому краю — ширины min(420px, 100vw − 40px) как раз хватает до
	 * правого поля.
	 */
	@media (max-width: 520px) {
		.birth-popover {
			left: 0;
			right: auto;
		}
	}

	.disclose {
		appearance: none;
		background: none;
		border: 0;
		color: var(--ink-dim);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		cursor: pointer;
		border-bottom: 1px solid var(--ink-faint);
		padding-bottom: 2px;
	}
	.disclose:hover {
		color: var(--ink);
	}

	/*
	 * Подвал — тем же тихим капсом, что строки о карте под именем, только
	 * текст о движке и данных строчными: это два предложения, капсом их
	 * тяжело читать. Ширина строки ограничена, чтобы абзац не тянулся на
	 * весь экран.
	 */
	.site-foot {
		margin-top: 56px;
	}
	.site-foot p {
		max-width: 62ch;
		font-size: 11px;
		line-height: 1.6;
		letter-spacing: 0.02em;
		color: var(--ink-faint);
	}
	.site-foot .method,
	.site-foot .author {
		margin-top: 14px;
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}
	.site-foot .author {
		margin-top: 6px;
		color: var(--ink-dim);
	}
	/*
	 * Кусок текста, который переносится только целиком: «ASC 12°05′ Leo»,
	 * «Open-Meteo», «major aspects». Один класс на шапку и подвал.
	 */
	.nowrap {
		white-space: nowrap;
	}
</style>

<script lang="ts">
	import { SIGN_GLYPHS, elementOf, toZodiac } from '$lib/astro/format';
	import { BODY_BY_ID } from '$lib/astro/bodies';
	import type { Aspect } from '$lib/astro/aspects';
	import type { BodyPosition, HouseFrame } from '$lib/astro/types';
	import { WHEEL, arcPath, declutter, polar } from './geometry';
	import { t } from '$lib/copy';
	import { fade } from 'svelte/transition';

	/*
	 * Переходы Svelte не смотрят на системную настройку «уменьшить движение»
	 * сами — CSS-медиазапрос на них не действует. Проверяем её вручную.
	 */
	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	interface Props {
		houses: HouseFrame;
		natal: BodyPosition[];
		/** Транзитные положения; null — режим натала, внешнее кольцо не рисуется. */
		transits?: BodyPosition[] | null;
		aspects?: Aspect[];
		/**
		 * Выбранный в списке точный транзит. Его хорда рисуется в полную силу
		 * чернил, чтобы было видно, о каком именно аспекте речь.
		 */
		highlight?: { transitId: string; targetId: string; aspectId: string } | null;
		/**
		 * Что сейчас на колесе: 'natal', 'transits', 'synastry'. По смене слоя
		 * хорды и внешнее кольцо перетекают друг в друга, а не меняются рывком.
		 */
		layer?: string;
	}

	let {
		houses,
		natal,
		transits = null,
		aspects = [],
		highlight = null,
		layer = 'natal'
	}: Props = $props();

	/*
	 * Длительности перехода. Новое проявляется дольше, чем гаснет старое: так
	 * при перетекании нет момента, когда на колесе пусто или всё вдвое плотнее.
	 */
	const FADE_IN = reduceMotion ? 0 : 450;
	const FADE_OUT = reduceMotion ? 0 : 250;

	/*
	 * Ключ сетки хорд — какой набор аспектов нарисован. Не просто layer: при
	 * переходе в транзиты несколько сотен миллисекунд транзитов ещё нет и
	 * рисуется натальная сетка. Смена набора случается, когда они приходят, —
	 * тогда и перетекаем. Шаги ползунка ключ не меняют, и линии не мигают.
	 */
	const gridKey = $derived(transits ? layer : 'natal');

	const asc = $derived(houses.ascendant);
	const at = (lon: number, radius: number) => polar(lon, radius, asc);

	/**
	 * Раскладка планет на кольце.
	 *
	 * Глиф встаёт на своё кольцо в разведённой позиции, точка истинного градуса
	 * ложится ровно на соседний круг, градус — надстрочником вплотную к глифу.
	 */
	function layout(bodies: BodyPosition[], radius: number, dotRadius: number) {
		const plotted = declutter(
			bodies.map((b) => b.longitude),
			WHEEL.declutterGap
		);
		// точки внутри кольца глифов (натал) — подпись отводим наружу,
		// точки снаружи (транзиты) — внутрь; так надстрочник не ложится на круг
		const dotsInside = dotRadius < radius;
		return bodies.map((body, i) => {
			const [gx, gy] = at(plotted[i], radius);
			const [tx, ty] = at(body.longitude, dotRadius);
			/*
			 * Надстрочник приклеен к глифу в экранных координатах: сбоку и чуть
			 * выше, как индекс у буквы. Сторону выбираем по половине колеса —
			 * слева «наружу» значит влево, справа вправо. Если ставить подпись на
			 * свой радиус со сдвигом по дуге, она уплывает от глифа к кругу точек
			 * и оказывается между соседями — непонятно, чья она.
			 */
			const outward = gx < WHEEL.cx ? -1 : 1;
			const side = dotsInside ? outward : -outward;
			return {
				body,
				glyph: BODY_BY_ID[body.id].glyph,
				degree: toZodiac(body.longitude).degree,
				gx, gy, tx, ty,
				dx: gx + side * 11,
				dy: gy - 6,
				anchor: side < 0 ? 'end' : 'start'
			};
		});
	}

	const natalLayout = $derived(layout(natal, WHEEL.natal, WHEEL.aspect));
	const transitLayout = $derived(
		transits ? layout(transits, WHEEL.transit, WHEEL.transitDot) : []
	);

	/** Противоположный угол: DSC напротив ASC, IC напротив MC. */
	const OPPOSITE_ANGLE: Record<string, string> = { asc: 'dsc', dsc: 'asc', mc: 'ic', ic: 'mc' };

	/*
	 * Соединение хордой не рисуется, и клик по «Jupiter conjunct DSC» ничего бы
	 * не подсветил. Но соединение с углом — это та же минута, что оппозиция к
	 * противоположному углу, а её хорда на колесе есть. Её и подсвечиваем.
	 */
	const strongTarget = $derived.by(() => {
		if (!highlight) return null;
		const opposite = OPPOSITE_ANGLE[highlight.targetId];
		return highlight.aspectId === 'conjunction' && opposite
			? { ...highlight, targetId: opposite, aspectId: 'opposition' }
			: highlight;
	});

	/** Аспект как хорда внутреннего круга — от истинного градуса к истинному. */
	const aspectLines = $derived(
		aspects
			.filter((a) => a.def.angle !== 0) // соединение линией не рисуем
			.map((a) => {
				const [x1, y1] = at(a.from.longitude, WHEEL.aspect);
				const [x2, y2] = at(a.to.longitude, WHEEL.aspect);
				return {
					x1, y1, x2, y2,
					kind: a.def.id,
					glyph: a.def.glyph,
					hard: a.def.quality === 'hard',
					strong:
						strongTarget !== null &&
						a.from.id === strongTarget.transitId &&
						a.to.id === strongTarget.targetId &&
						a.def.id === strongTarget.aspectId,
					mx: (x1 + x2) / 2,
					my: (y1 + y2) / 2
				};
			})
	);

	/*
	 * Четыре угла на круге аспектов — туда приходят хорды аспектов к углам.
	 * Кольцо, а не сплошная точка, как у планет: иначе хорда к ASC выглядит
	 * хордой к планете, которая стоит рядом (Нептун в 1° от ASC — и уже не
	 * понять, к кому аспект). Сплошная = планета, кольцо = угол.
	 */
	const anglePoints = $derived(
		// DSC и IC — ровно напротив ASC и MC, как в chartAngles
		[0, 180].flatMap((d) => [houses.ascendant + d, houses.midheaven + d]).map((lon) => {
			const [x, y] = at(lon, WHEEL.aspect);
			return { x, y };
		})
	);

	const ticks = $derived(
		Array.from({ length: 360 }, (_, d) => {
			const major = d % 30 === 0;
			const inner = major ? WHEEL.signInner - 10 : d % 5 === 0 ? WHEEL.signInner - 6 : WHEEL.signInner - 3;
			const [x1, y1] = at(d, WHEEL.signInner);
			const [x2, y2] = at(d, inner);
			return { x1, y1, x2, y2, major };
		})
	);

	const signs = $derived(
		Array.from({ length: 12 }, (_, i) => {
			const [x1, y1] = at(i * 30, WHEEL.signInner);
			const [x2, y2] = at(i * 30, WHEEL.signOuter);
			const [gx, gy] = at(i * 30 + 15, WHEEL.signMid);
			return {
				x1, y1, x2, y2, gx, gy,
				glyph: SIGN_GLYPHS[i],
				// стихия задаёт цвет знака в цветной палитре; в монохроме
				// все четыре переменные разрешаются в обычный цвет чернил
				element: elementOf(i),
				/*
				 * Цветом стихии обводятся только дуги знака — внешняя и внутренняя.
				 * Радиальная граница у двух соседних знаков общая, а одна линия не
				 * может быть двух цветов сразу, поэтому разделители остаются
				 * нейтральными. Дуги встык, без зазоров: кольцо остаётся цельным.
				 */
				outerArc: arcPath(i * 30, (i + 1) * 30, WHEEL.signOuter, asc),
				innerArc: arcPath(i * 30, (i + 1) * 30, WHEEL.signInner, asc)
			};
		})
	);

	/** Подписи домов: римская цифра, а у четырёх углов вместо цифры имя угла. */
	const CUSP_LABELS = ['As', 'II', 'III', 'Ic', 'V', 'VI', 'Ds', 'VIII', 'IX', 'Mc', 'XI', 'XII'];

	const cusps = $derived(
		houses.cusps.map((cusp, i) => {
			const [x1, y1] = at(cusp, WHEEL.aspect);
			const [x2, y2] = at(cusp, WHEEL.houseLineOuter);
			const [lx, ly] = at(cusp, WHEEL.cuspLabel);
			return {
				x1, y1, x2, y2, lx, ly,
				// подпись отталкивается от кольца: слева растёт влево, справа вправо
				anchor: lx < WHEEL.cx - 12 ? 'end' : lx > WHEEL.cx + 12 ? 'start' : 'middle',
				label: CUSP_LABELS[i],
				degree: toZodiac(cusp).degree,
				number: i + 1,
				// углы карты (I, IV, VII, X) выделены
				angle: i % 3 === 0
			};
		})
	);
</script>

<svg viewBox={WHEEL.viewBox} role="img" aria-label={t.wheelLabel}>
	<!--
		Раньше при появлении внешнего кольца всё колесо поворачивалось на −4°,
		чтобы «ожить». Это ломало главную условность карты: ASC строго слева,
		горизонт горизонтален, — и натальные планеты сдвигались, хотя их
		положение не менялось. Теперь рамка стоит на месте, а отклик на
		переключение — проявление самого кольца (fade ниже).
	-->
	<g>
		<g class="rings">
			<circle class="sign-ring" cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.signOuter} />
			<circle class="sign-ring" cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.signInner} />
			<circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.aspect} stroke-width="0.6" />
		</g>

		<g class="signs">
			{#each signs as s (s.glyph)}
				<path class="sign-arc {s.element}" d={s.outerArc} />
				<path class="sign-arc {s.element}" d={s.innerArc} />
				<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
				<text
					x={s.gx}
					y={s.gy}
					class="sign {s.element}"
					text-anchor="middle"
					dominant-baseline="central"
				>
					{s.glyph}
				</text>
			{/each}
		</g>

		<g class="ticks">
			{#each ticks as t, i (i)}
				<line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} class:major={t.major} />
			{/each}
		</g>

		<g class="houses">
			{#each cusps as h (h.number)}
				<line x1={h.x1} y1={h.y1} x2={h.x2} y2={h.y2} class:angle={h.angle} />
				<text
					x={h.lx}
					y={h.ly}
					class="cusp-label"
					class:angle={h.angle}
					text-anchor={h.anchor}
					dominant-baseline="central"
				>
					<!--
						Знак градуса тут не украшение. Градус округляется вниз, как и
						везде в приложении, поэтому куспид на 0°45′ даёт «0» — голая
						ноль-цифра читается как отсутствие данных, а «0°» как значение.
					-->
					{h.label}<tspan class="cusp-deg" dy="-4">{h.degree}°</tspan>
				</text>
			{/each}
		</g>

		{#key gridKey}
		<g
			class="aspects"
			in:fade|global={{ duration: FADE_IN }}
			out:fade|global={{ duration: FADE_OUT }}
		>
			{#each aspectLines as a, i (i)}
				<line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} class:hard={a.hard} class:strong={a.strong} />
			{/each}
			{#each aspectLines as a, i (i)}
				<circle class="marker-bg" cx={a.mx} cy={a.my} r="6.5" />
				<text
					class="marker {a.kind}"
					class:strong={a.strong}
					x={a.mx}
					y={a.my}
					text-anchor="middle"
					dominant-baseline="central"
				>
					{a.glyph}
				</text>
			{/each}
		</g>
		{/key}

		<g class="angle-points">
			{#each anglePoints as p, i (i)}
				<circle cx={p.x} cy={p.y} r="3" />
			{/each}
		</g>

		{#snippet ring(items: ReturnType<typeof layout>, kind: string)}
			<g class="planets {kind}">
				{#each items as p (p.body.id)}
					<circle class="truedot" cx={p.tx} cy={p.ty} r="2" />
					<text x={p.gx} y={p.gy} class="pl" text-anchor="middle" dominant-baseline="central">
						{p.glyph}
					</text>
					<text x={p.dx} y={p.dy} class="deg" text-anchor={p.anchor} dominant-baseline="central">
						{p.degree}°{p.body.retrograde ? '℞' : ''}
					</text>
				{/each}
			</g>
		{/snippet}

		{@render ring(natalLayout, 'natal')}
		{#if transits}
			<!--
				Кольцо проявляется, когда появляется, перетекает при смене
				транзитов на партнёра и гаснет при возврате в натал. На шагах
				ползунка ключ тот же — кольцо не мигает. |global нужен, чтобы
				угасание сыграло и тогда, когда пропадает весь блок {#if}, а не
				только сам {#key}.
			-->
			{#key layer}
				<g in:fade|global={{ duration: FADE_IN }} out:fade|global={{ duration: FADE_OUT }}>
					{@render ring(transitLayout, 'transit')}
				</g>
			{/key}
		{/if}
	</g>
</svg>

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
		overflow: visible;
		font-family: var(--grot);
	}

	.rings circle {
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 1;
	}

	.signs line {
		stroke: var(--ink-faint);
		stroke-width: 1;
	}
	.sign {
		font-family: var(--glyph);
		font-size: 19px;
		transition: fill 0.35s ease;
	}
	/* цвет приходит из палитры: в монохроме все четыре = приглушённые чернила */
	.fire {
		fill: var(--sign-fire);
		stroke: var(--sign-fire);
	}
	.earth {
		fill: var(--sign-earth);
		stroke: var(--sign-earth);
	}
	.air {
		fill: var(--sign-air);
		stroke: var(--sign-air);
	}
	.water {
		fill: var(--sign-water);
		stroke: var(--sign-water);
	}

	/*
	 * Цветные дуги знаков. Только контур, без заливки: цвет стихии несут дуги
	 * знака и сам глиф. В монохроме дуг нет — кольцо рисуется серыми окружностями.
	 */
	.sign-arc {
		fill: none;
		stroke-width: 1.2;
		opacity: 0;
		transition: opacity 0.35s ease;
	}
	.sign-ring {
		transition: opacity 0.35s ease;
	}
	:global(:root[data-palette='elements']) .sign-arc {
		opacity: 1;
	}
	/* цветные дуги лежат ровно на серых окружностях — серые прячем, чтобы не двоилось */
	:global(:root[data-palette='elements']) .sign-ring {
		opacity: 0;
	}

	.ticks line {
		stroke: var(--ink-faint);
		stroke-width: 0.5;
		opacity: 0.5;
	}
	.ticks line.major {
		stroke-width: 0.9;
		opacity: 0.9;
	}

	.houses line {
		stroke: var(--ink-ghost);
		stroke-width: 0.7;
	}
	.houses line.angle {
		stroke: var(--ink-faint);
		stroke-width: 1;
	}
	.cusp-label {
		font-size: 10px;
		letter-spacing: 0.1em;
		fill: var(--ink-faint);
	}
	/* углы карты — единственное, что выделено среди подписей */
	.cusp-label.angle {
		fill: var(--ink-dim);
	}
	.cusp-deg {
		font-size: 7.5px;
		letter-spacing: 0;
	}

	.aspects line {
		stroke: var(--soft);
		stroke-width: 0.7;
	}
	.aspects line.hard {
		stroke: var(--hard);
		stroke-width: 0.8;
		stroke-dasharray: 3 4;
	}
	/*
	 * Выбранный аспект — полной силой чернил: на светлой теме почти чёрный, на
	 * тёмной почти белый. Остальные хорды идут полупрозрачными, поэтому
	 * выбранная выступает вперёд. Пунктир снимаем: сплошная читается заметнее.
	 */
	.aspects line.strong,
	.aspects line.hard.strong {
		stroke: var(--ink);
		stroke-width: 1.4;
		stroke-dasharray: none;
	}
	.marker.strong,
	:global(:root[data-palette='elements']) .marker.strong {
		fill: var(--ink);
	}

	.marker-bg {
		fill: var(--bg);
	}
	/* размер одинаковый в обеих палитрах — меняется только цвет */
	.marker {
		font-family: var(--glyph);
		font-size: 10px;
		fill: var(--ink-faint);
		transition: fill 0.35s ease;
	}
	/*
	 * В цветной палитре значок аспекта красится по типу — сразу видно, где
	 * напряжение, а где гармония, не вчитываясь в сам символ.
	 */
	:global(:root[data-palette='elements']) .marker.square,
	:global(:root[data-palette='elements']) .marker.opposition {
		fill: var(--aspect-hard);
	}
	:global(:root[data-palette='elements']) .marker.trine {
		fill: var(--aspect-trine);
	}
	:global(:root[data-palette='elements']) .marker.sextile {
		fill: var(--aspect-sextile);
	}

	/* заливка фоном прячет под кольцом концы хорд — точка читается пустой */
	.angle-points circle {
		fill: var(--bg);
		stroke: var(--ink-dim);
		stroke-width: 1;
	}

	.truedot {
		fill: var(--ink-dim);
	}
	.pl {
		font-family: var(--glyph);
		font-size: 20px;
		fill: var(--ink);
	}
	.planets.transit .pl {
		opacity: 0.92;
	}
	.deg {
		font-size: 8.5px;
		fill: var(--ink-dim);
		letter-spacing: 0.04em;
	}
</style>

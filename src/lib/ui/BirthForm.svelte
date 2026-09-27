<script lang="ts">
	import { untrack } from 'svelte';
	import { describePlace, searchPlaces, type Place } from '$lib/astro/geocode';
	import { formatDate, listTimeZones, parseDate, parseTime, to12Hour } from '$lib/astro/time';
	import type { BirthData } from '$lib/astro/types';
	import { t } from '$lib/copy';

	interface Props {
		value: BirthData;
		onsubmit: (next: BirthData) => void;
		/** Подпись кнопки. Форма одна на две роли: своя карта и карта партнёра. */
		submitLabel?: string;
	}

	let { value, onsubmit, submitLabel = t.recalculate }: Props = $props();

	// Локальная копия: карта пересчитывается по «применить», а не на каждый keypress.
	// untrack — чтобы инициализация не считалась подпиской; синхронизацию с
	// внешним значением делает эффект ниже.
	/*
	 * В черновике координаты могут быть пустыми (null): так Svelte показывает
	 * пустое числовое поле. Пустая форма партнёра приходит с NaN — «координат
	 * нет», — и если отдать NaN в поле как есть, браузер ругается в консоли,
	 * что не может его разобрать. Поэтому NaN превращаем в null на входе.
	 */
	type Draft = Omit<BirthData, 'latitude' | 'longitude'> & {
		latitude: number | null;
		longitude: number | null;
	};
	const toDraft = (v: BirthData): Draft => ({
		...v,
		latitude: Number.isNaN(v.latitude) ? null : v.latitude,
		longitude: Number.isNaN(v.longitude) ? null : v.longitude
	});

	let draft = $state<Draft>(untrack(() => toDraft(value)));
	$effect(() => {
		draft = toDraft(value);
		resolvedPlace = value.place;
	});

	const zones = listTimeZones();

	// ── поиск места ───────────────────────────────────────────────────
	let query = $state('');
	let results = $state<Place[]>([]);
	let searching = $state(false);
	// флаг, а не готовый текст: сообщение берётся из словаря при отрисовке,
	// поэтому после смены языка оно не останется на старом
	let searchFailed = $state(false);

	/**
	 * Название места, для которого реально подставлены координаты.
	 * Если человек правит поле руками и не выбирает из списка, координаты
	 * остаются от прежнего города — и карта молча считается не по тому месту.
	 * Расхождение показываем явно.
	 */
	let resolvedPlace = $state(untrack(() => value.place));
	const placeStale = $derived(draft.place.trim() !== resolvedPlace.trim());

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: AbortController | undefined;

	function onPlaceInput(event: Event) {
		const text = (event.currentTarget as HTMLInputElement).value;
		draft.place = text;
		query = text;

		clearTimeout(searchTimer);
		inFlight?.abort();

		if (text.trim().length < 2) {
			results = [];
			searching = false;
			searchFailed = false;
			return;
		}

		searching = true;
		searchFailed = false;
		// пауза, чтобы не дёргать геокодер на каждую букву
		searchTimer = setTimeout(async () => {
			const controller = new AbortController();
			inFlight = controller;
			try {
				const found = await searchPlaces(text, controller.signal);
				if (!controller.signal.aborted) results = found;
			} catch (e) {
				if ((e as Error).name !== 'AbortError') {
					searchFailed = true;
					results = [];
				}
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, 250);
	}

	function choose(place: Place) {
		draft.place = place.name;
		draft.latitude = place.latitude;
		draft.longitude = place.longitude;
		draft.timezone = place.timezone;
		resolvedPlace = place.name;
		results = [];
		query = '';
		searchFailed = false;
	}

	function closeResults() {
		results = [];
	}

	/**
	 * Дата и время — свои текстовые поля, а не <input type="date"/"time">.
	 *
	 * У нативных полей формат отображения диктует локаль операционной системы:
	 * на en-US это месяц/день/год и AM/PM, и повлиять на это со страницы нельзя.
	 * Здесь формат наш: день.месяц.год и 24 часа. В BirthData всё равно уходит
	 * ISO — хранение не меняется, меняется только то, что видит человек.
	 */
	let dateText = $state(untrack(() => formatDate(value.date)));
	let timeText = $state(untrack(() => value.time));
	$effect(() => {
		dateText = formatDate(value.date);
		timeText = value.time;
	});

	const parsedDate = $derived(parseDate(dateText));
	const parsedTime = $derived(parseTime(timeText));
	/** Подсказка в 12-часовом виде — чтобы «21:20» читалось и как 9:20 PM. */
	const timeHint = $derived(parsedTime ? to12Hour(parsedTime) : null);

	/** Нормализуем ввод, когда человек уходит из поля: «1.1.2000» → «01.01.2000». */
	function normalizeDate() {
		if (parsedDate) dateText = formatDate(parsedDate);
	}
	function normalizeTime() {
		if (parsedTime) timeText = parsedTime;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!parsedDate || !parsedTime) return;
		onsubmit({
			...draft,
			date: parsedDate,
			time: parsedTime,
			latitude: Number(draft.latitude),
			longitude: Number(draft.longitude)
		});
	}
</script>

<form onsubmit={submit}>
	<label>
		<span>{t.name}</span>
		<input bind:value={draft.name} required />
	</label>

	<div class="place">
		<label>
			<span>{t.birthplace}</span>
			<input
				value={draft.place}
				oninput={onPlaceInput}
				onkeydown={(e) => e.key === 'Escape' && closeResults()}
				autocomplete="off"
				placeholder={t.birthplacePlaceholder}
			/>
		</label>

		{#if searching}
			<p class="hint">{t.searching}</p>
		{:else if searchFailed}
			<p class="hint warn">{t.searchFailed}</p>
		{:else if placeStale}
			<p class="hint warn">{t.placeStale}</p>
		{/if}

		{#if results.length}
			<ul class="results">
				{#each results as place (place.id)}
					<li>
						<button type="button" onclick={() => choose(place)}>
							<span class="city">{place.name}</span>
							<span class="where">{describePlace(place)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<label>
		<span>{t.date}</span>
		<input
			bind:value={dateText}
			onblur={normalizeDate}
			inputmode="numeric"
			placeholder={t.datePlaceholder}
			aria-invalid={dateText.trim() !== '' && !parsedDate}
			required
		/>
		{#if dateText.trim() !== '' && !parsedDate}
			<em class="bad">{t.dateInvalid}</em>
		{/if}
	</label>
	<label>
		<span>{t.time}</span>
		<input
			bind:value={timeText}
			onblur={normalizeTime}
			inputmode="numeric"
			placeholder={t.timePlaceholder}
			aria-invalid={timeText.trim() !== '' && !parsedTime}
			required
		/>
		{#if timeHint}
			<em class="ok">{timeHint}</em>
		{:else if timeText.trim() !== ''}
			<em class="bad">{t.timeInvalid}</em>
		{/if}
	</label>

	<p class="section">{t.coordsSection}</p>

	<!--
		step="any" здесь обязателен. С фиксированным шагом (например 0.0001)
		браузер отвергает координаты с большим числом знаков — геокодер отдаёт
		49.98177 — и форма молча перестаёт отправляться: пузырёк валидации висит
		на поле, которого не видно на экране. Координаты непрерывны, квантовать
		их незачем.
	-->
	<label>
		<span>{t.latitude}</span>
		<input type="number" step="any" min="-90" max="90" bind:value={draft.latitude} required />
	</label>
	<label>
		<span>{t.longitude}</span>
		<input type="number" step="any" min="-180" max="180" bind:value={draft.longitude} required />
	</label>
	<label class="wide">
		<span>{t.timezone}</span>
		<input list="tz-list" bind:value={draft.timezone} required />
		<datalist id="tz-list">
			{#each zones as zone (zone)}
				<option value={zone}></option>
			{/each}
		</datalist>
	</label>

	<button class="apply" type="submit" disabled={!parsedDate || !parsedTime}>
		{submitLabel}
	</button>
</form>

<style>
	form {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px 18px;
		margin-top: 20px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	label.wide,
	.place,
	.section {
		grid-column: 1 / -1;
	}
	span {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	input {
		background: none;
		border: 0;
		border-bottom: 1px solid var(--ink-faint);
		padding: 6px 0;
		font-size: 14px;
		width: 100%;
	}
	input:focus {
		border-bottom-color: var(--ink);
	}
	/*
	 * Убираем стрелки-крутилки у полей координат. Их рисует сам браузер, у
	 * каждого по-своему, и стилизовать их нельзя — только скрыть. Для координат
	 * они и не нужны: значения приходят из поиска города или вводятся целиком.
	 * Стрелки на клавиатуре при этом продолжают работать.
	 */
	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}
	input::placeholder {
		color: var(--ink-ghost);
	}
	input[aria-invalid='true'] {
		border-bottom-color: var(--ink-dim);
		border-bottom-style: dashed;
	}

	em {
		font-style: normal;
		font-size: 10px;
		letter-spacing: 0.06em;
	}
	em.ok {
		color: var(--ink-faint);
	}
	em.bad {
		color: var(--ink-dim);
	}

	.place {
		position: relative;
	}
	.hint {
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
		margin-top: 6px;
	}
	.hint.warn {
		color: var(--ink-dim);
	}

	.results {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		border: 1px solid var(--ink-faint);
		background: var(--bg);
		max-height: 240px;
		overflow-y: auto;
		position: absolute;
		z-index: 2;
		width: 100%;
	}
	.results li + li {
		border-top: 1px solid var(--ink-ghost);
	}
	.results button {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		text-align: left;
		appearance: none;
		background: none;
		border: 0;
		padding: 9px 12px;
		cursor: pointer;
	}
	.results button:hover,
	.results button:focus-visible {
		background: rgba(236, 231, 222, 0.06);
	}
	.city {
		font-size: 14px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--ink);
	}
	.where {
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: none;
		color: var(--ink-faint);
	}

	/*
	 * Без разделительной линии: прямо над подписью идёт подчёркивание поля
	 * «Time», и две горизонтали в паре пикселей читались как сдвоенная черта.
	 * Секцию отделяет отступ.
	 */
	.section {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-ghost);
		margin-top: 22px;
	}

	/* прямоугольная, как переключатель слоя: скруглений в интерфейсе нет */
	.apply {
		grid-column: 1 / -1;
		justify-self: start;
		appearance: none;
		background: none;
		border: 1px solid var(--ink-faint);
		padding: 9px 22px;
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		cursor: pointer;
		transition: 0.25s;
		margin-top: 8px;
	}
	.apply:hover:not(:disabled) {
		background: var(--ink);
		color: var(--bg);
	}
	.apply:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>

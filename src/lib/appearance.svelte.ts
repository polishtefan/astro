/**
 * Оформление: тема (день/ночь) и палитра (моно/цвет).
 *
 * Значения живут атрибутами на <html>, а не в классах компонентов, — так CSS
 * переключается разом по всему дереву, включая SVG внутри колеса.
 *
 * Чтобы при загрузке не мигало тёмной темой на светлой, начальные атрибуты
 * ставит крошечный синхронный скрипт в src/app.html; здесь мы лишь читаем то,
 * что он уже проставил, и дальше держим синхронизацию.
 */

export type Theme = 'dark' | 'light';
export type Palette = 'mono' | 'elements';

export const STORAGE_KEY = 'astro:appearance';

export const appearance = $state<{ theme: Theme; palette: Palette }>({
	theme: 'dark',
	palette: 'mono'
});

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(appearance)));
	} catch {
		// приватный режим или заблокированное хранилище — не повод падать
	}
}

function apply() {
	const root = document.documentElement;
	root.dataset.theme = appearance.theme;
	root.dataset.palette = appearance.palette;
}

/** Подхватить то, что уже стоит на <html>. Вызывается один раз при монтировании. */
export function syncAppearanceFromDom() {
	const root = document.documentElement;
	if (root.dataset.theme === 'light' || root.dataset.theme === 'dark') {
		appearance.theme = root.dataset.theme;
	}
	if (root.dataset.palette === 'mono' || root.dataset.palette === 'elements') {
		appearance.palette = root.dataset.palette;
	}
}

export function setTheme(theme: Theme) {
	appearance.theme = theme;
	apply();
	persist();
}

export function setPalette(palette: Palette) {
	appearance.palette = palette;
	apply();
	persist();
}


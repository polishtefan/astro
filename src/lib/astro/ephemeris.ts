import { base } from '$app/paths';
import type SwissEPH from 'sweph-wasm';

/**
 * Ленивая загрузка Swiss Ephemeris.
 *
 * Движок — это ~570 КБ wasm плюс ~2 МБ файлов эфемерид (.se1), поэтому грузим
 * его один раз на вкладку и только в браузере. Файлы лежат в static/ и
 * копируются из пакета скриптом scripts/copy-sweph-assets.js — так мы не
 * зависим от чужого CDN, который стоит в дефолте sweph-wasm.
 */
let pending: Promise<SwissEPH> | null = null;

export function loadEphemeris(): Promise<SwissEPH> {
	if (!pending) {
		pending = (async () => {
			const { default: SwissEPHClass } = await import('sweph-wasm');
			const swe = await SwissEPHClass.init(`${base}/swisseph.wasm`);
			// монтирует seas_18 / sepl_18 / semo_18 в виртуальную ФС wasm-модуля
			await swe.swe_set_ephe_path(`${base}/ephe/`);
			return swe;
		})().catch((err) => {
			pending = null; // разрешаем повторную попытку после сетевой ошибки
			throw err;
		});
	}
	return pending;
}

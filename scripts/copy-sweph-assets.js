/**
 * Копирует ассеты Swiss Ephemeris из node_modules в static/, чтобы они
 * раздавались с нашего домена (без CDN автора пакета).
 *
 * - swisseph.wasm — сам движок
 * - se{pl,mo,as}_18.se1 — эфемериды на 1800–2400 гг: планеты, Луна, астероиды
 *   (последнее нужно для Хирона). Этого набора хватает для любых дат рождения
 *   и транзитов, с которыми мы будем работать.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = join('node_modules', 'sweph-wasm', 'dist');

const EPHE_FILES = ['sepl_18.se1', 'semo_18.se1', 'seas_18.se1'];

mkdirSync('static/ephe', { recursive: true });
copyFileSync(join(dist, 'wasm', 'swisseph.wasm'), 'static/swisseph.wasm');
for (const f of EPHE_FILES) copyFileSync(join(dist, 'ephe', f), join('static/ephe', f));

console.log(`swisseph.wasm + ${EPHE_FILES.length} ephemeris files -> static/`);

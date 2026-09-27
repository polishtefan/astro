import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			/*
			 * Сайт целиком статический: Swiss Ephemeris считает в браузере, город
			 * браузер ищет сам, хранить нечего. Поэтому сборка — набор готовых
			 * файлов в build/, которые раздаёт GitHub Pages, без своего сервера.
			 */
			adapter: adapter(),

			/*
			 * На GitHub Pages сайт живёт в подпапке: polishtefan.github.io/astro.
			 * Путь приходит из переменной окружения, которую ставит сборка на
			 * GitHub (.github/workflows/deploy.yml). Локально её нет — дев-сервер
			 * и `npm run preview` работают из корня, как раньше.
			 */
			paths: {
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	]
});

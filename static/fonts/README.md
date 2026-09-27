# Шрифты

| Файл | Семейство | Начертание |
| --- | --- | --- |
| `space-grotesk-400-latin*.woff2` | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | 400 |
| `space-mono-400-latin*.woff2` | [Space Mono](https://fonts.google.com/specimen/Space+Mono) | 400 |

Оба — **SIL Open Font License 1.1**: можно свободно использовать, встраивать и
распространять, в том числе в коммерческих проектах. Условие одно: вместе со
шрифтами распространяется текст лицензии с копирайтом. Он лежит здесь же —
`OFL-SpaceGrotesk.txt` и `OFL-SpaceMono.txt`, дословно из
[репозитория Google Fonts](https://github.com/google/fonts); файлы отличаются
только строкой копирайта.

Подключаются в `src/app.css` через `@font-face`, а не с Google Fonts: так они
работают офлайн (понадобится для PWA) и не сообщают Google о посетителях.

Взяты подмножества `latin` и `latin-ext`, только вес 400 — всё, что нужно
интерфейсу. Вместе 44 КБ. Обновить: скачать woff2 с Google Fonts и заменить
файлы, `unicode-range` в `app.css` менять не нужно.

/** Данные рождения — единственный «вход» карты вместе с датой наблюдения. */
export interface BirthData {
	name: string;
	/** Локальная дата рождения, 'YYYY-MM-DD' — ровно как записано в документах. */
	date: string;
	/** Локальное время рождения, 'HH:mm'. */
	time: string;
	place: string;
	/** Широта в градусах, север положительный. */
	latitude: number;
	/** Долгота в градусах, восток положительный. */
	longitude: number;
	/** Часовой пояс места рождения, IANA (например 'Europe/Moscow'). */
	timezone: string;
}

export type BodyId =
	| 'sun'
	| 'moon'
	| 'mercury'
	| 'venus'
	| 'mars'
	| 'jupiter'
	| 'saturn'
	| 'uranus'
	| 'neptune'
	| 'pluto'
	| 'node'
	| 'southNode'
	| 'chiron';

export interface BodyPosition {
	id: BodyId;
	/** Эклиптическая долгота, 0–360°. Это единственная координата, которая нужна колесу. */
	longitude: number;
	/** Эклиптическая широта — пока не рисуем, но пригодится для параллелей. */
	latitude: number;
	/** Скорость по долготе, °/сутки. Отрицательная = ретроградность. */
	speed: number;
	retrograde: boolean;
	/** Дом (1–12) в системе домов карты. */
	house: number;
}

export interface HouseFrame {
	/** 12 куспидов, cusps[0] — куспид I дома (он же ASC). */
	cusps: number[];
	ascendant: number;
	midheaven: number;
	/** Код системы домов Swiss Ephemeris: 'P' = Placidus. */
	system: string;
}

/**
 * Карта — чистая функция от (данные рождения, дата наблюдения).
 * Натал: observation === момент рождения. Транзиты: observation === сейчас/скраббер.
 */
export interface Chart {
	birth: BirthData;
	/** Момент наблюдения в UTC. */
	observation: Date;
	/** Юлианский день UT момента наблюдения. */
	julianDay: number;
	positions: BodyPosition[];
	/** Дома всегда от места и момента РОЖДЕНИЯ — транзиты ложатся на натальную рамку. */
	houses: HouseFrame;
}

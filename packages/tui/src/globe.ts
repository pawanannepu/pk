/**
 * Land at 5° resolution: 36 rows (90°N to 90°S) of 72 cells (180°W to 180°E), `#` for land. Derived
 * once from the public domain Natural Earth 1:110m land polygons (`ne_110m_land`), sampling each
 * cell's center. Committed so the hero never reads a file or the network.
 */
export const LAND_MASK: readonly string[] = [
	"........................................................................",
	"...................#####...#####........................................",
	"............#.....##..##########.......##...............................",
	"...........####.#.###....#######..............#...#.##########..#.......",
	"#..###############.#.##..####..........#####..##########################",
	"...###############.##.#...#..........##################################.",
	"....##...########....###...........#..#.########################...##...",
	"..........###############.........##.############################..#....",
	"............###########............##############################.......",
	"...........###########............###.#.##..##.###############..#.......",
	"...........##########.............##....######.#############.#..........",
	".............#######..............#####.#..#################............",
	".............####..#.............#############.#############............",
	"...............#.................##########.####..#########.............",
	"................##...............##############....##..##...............",
	".................................############......#....##..............",
	"....................####.........#############..............#...........",
	"....................######............#######...........#.##............",
	"....................#######...........######............#.#....#........",
	"....................#########..........#####.............##.....#.......",
	".....................#######...........#####..................#.#.......",
	"......................######..........######.#..............#####.......",
	"......................######...........####..#.............#######......",
	"......................####.............####................########.....",
	"......................####..............##.................##..###......",
	".....................####.......................................##......",
	".....................##..........................................#....#.",
	".....................##.................................................",
	".....................#..................................................",
	"........................................................................",
	"........................................................................",
	"......................#.......................##....#############.......",
	".......................#.........#####################################..",
	"....#################.........#######################################...",
	".....###################.############################################...",
	"########################################################################",
];

/** Which layer won a Braille cell: outline beats land, land beats graticule. */
export type GlobeLayer = "outline" | "land" | "graticule" | "none";

/** One rendered globe frame: a row of Braille characters per terminal row, and the winning layer per cell. */
export interface GlobeFrame {
	readonly rows: readonly string[];
	readonly layers: readonly (readonly GlobeLayer[])[];
}

/** The axial tilt the globe is drawn with, toward the viewer. */
export const GLOBE_TILT_DEG = 23.4;

const RAD = Math.PI / 180;
// Braille dot bits by [x][y] in a 2 by 4 cell.
const DOT_BITS = [
	[0x01, 0x02, 0x04, 0x40],
	[0x08, 0x10, 0x20, 0x80],
] as const;
const RANK: Readonly<Record<GlobeLayer, number>> = {
	none: 0,
	graticule: 1,
	land: 2,
	outline: 3,
};

function landAt(latDeg: number, lonDeg: number): boolean {
	const row = Math.min(35, Math.max(0, Math.floor((90 - latDeg) / 5)));
	const lon = (((lonDeg + 180) % 360) + 360) % 360;
	const col = Math.min(71, Math.floor(lon / 5));
	return LAND_MASK[row]?.[col] === "#";
}

const nearMultiple = (value: number, step: number, within: number): boolean => {
	const m = ((value % step) + step) % step;
	return m < within || step - m < within;
};

/**
 * The globe seen from far away (orthographic projection), tilted toward you and turned by
 * `rotationDeg`, drawn into `cols` by `rows` Braille cells (each a 2 by 4 grid of dots). Pure.
 * Pass `graticule: false` to leave out the grid lines (the `none` color mode).
 */
export function globeFrame(
	rotationDeg: number,
	cols: number,
	rows: number,
	options: { readonly graticule?: boolean } = {},
): GlobeFrame {
	const graticule = options.graticule ?? true;
	const width = cols * 2;
	const height = rows * 4;
	const radius = Math.min(width, height) / 2 - 0.5;
	const cx = (width - 1) / 2;
	const cy = (height - 1) / 2;
	const tilt = GLOBE_TILT_DEG * RAD;
	const bits: number[][] = Array.from({ length: rows }, () =>
		Array<number>(cols).fill(0),
	);
	const layers: GlobeLayer[][] = Array.from({ length: rows }, () =>
		Array<GlobeLayer>(cols).fill("none"),
	);

	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			const nx = (px - cx) / radius;
			const ny = (cy - py) / radius;
			const r2 = nx * nx + ny * ny;
			if (r2 > 1) continue;
			const nz = Math.sqrt(1 - r2);
			// Undo the tilt (around x), then read latitude and longitude, then undo the spin.
			const y = ny * Math.cos(tilt) + nz * Math.sin(tilt);
			const z = -ny * Math.sin(tilt) + nz * Math.cos(tilt);
			const lat = Math.asin(Math.max(-1, Math.min(1, y))) / RAD;
			const lon = Math.atan2(nx, z) / RAD - rotationDeg;
			const layer: GlobeLayer =
				Math.sqrt(r2) > 1 - 1.5 / radius
					? "outline"
					: landAt(lat, lon)
						? "land"
						: graticule &&
								(nearMultiple(lat, 30, 1.2) ||
									(Math.abs(lat) < 80 && nearMultiple(lon, 30, 1.2)))
							? "graticule"
							: "none";
			if (layer === "none") continue;
			const cellX = Math.floor(px / 2);
			const cellY = Math.floor(py / 4);
			const row = bits[cellY];
			const layerRow = layers[cellY];
			if (!row || !layerRow) continue;
			row[cellX] =
				(row[cellX] ?? 0) | (DOT_BITS[px % 2 === 0 ? 0 : 1][py % 4] ?? 0);
			if (RANK[layer] > RANK[layerRow[cellX] ?? "none"])
				layerRow[cellX] = layer;
		}
	}
	return {
		rows: bits.map((row) =>
			row
				.map((b) => (b === 0 ? " " : String.fromCharCode(0x2800 + b)))
				.join(""),
		),
		layers,
	};
}

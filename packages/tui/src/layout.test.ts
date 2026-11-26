import { describe, expect, test } from "bun:test";
import { GLOBE_TILT_DEG, globeFrame, LAND_MASK } from "./globe.ts";
import { layoutFor } from "./layout.ts";
import { fitActivity, fitStacked } from "./rail-fit.ts";

describe("layoutFor (spec 0003 AC-6)", () => {
	const at = (width: number, height = 40, railsHidden = false) =>
		layoutFor({ width, height, railsHidden });
	test("width boundaries", () => {
		expect(at(59)).toMatchObject({
			tooSmall: true,
			left: false,
			right: false,
			centerWidth: 59,
		});
		expect(at(60)).toMatchObject({
			tooSmall: false,
			left: false,
			right: false,
			centerWidth: 60,
		});
		expect(at(99)).toMatchObject({
			left: false,
			right: false,
			centerWidth: 99,
		});
		expect(at(100)).toMatchObject({
			left: false,
			right: true,
			centerWidth: 75,
		});
		expect(at(139)).toMatchObject({
			left: false,
			right: true,
			centerWidth: 114,
		});
		expect(at(140)).toMatchObject({ left: true, right: true, centerWidth: 90 });
	});
	test("height boundaries", () => {
		expect(at(140, 15).tooSmall).toBe(true);
		expect(at(140, 16).tooSmall).toBe(false);
	});
	test("railsHidden removes both rails at any width", () => {
		expect(at(200, 40, true)).toMatchObject({
			left: false,
			right: false,
			centerWidth: 200,
		});
	});
});

describe("rail fitting (spec 0003 AC-10)", () => {
	const left = [
		{ name: "SESSION", rows: 3 },
		{ name: "CONTEXT", rows: 2 },
		{ name: "PLAN", rows: 8 },
		{ name: "FILES", rows: 8 },
	];
	test("everything fits when there is room", () => {
		expect(fitStacked(left, 37).map((p) => p.rows)).toEqual([3, 2, 8, 8]);
	});
	test("panels drop from the bottom up: FILES, then PLAN", () => {
		expect(fitStacked(left, 20).map((p) => p.name)).toEqual([
			"SESSION",
			"CONTEXT",
			"PLAN",
		]);
		expect(fitStacked(left, 11).map((p) => p.name)).toEqual([
			"SESSION",
			"CONTEXT",
		]);
	});
	test("a panel needs its title row and one content row", () => {
		expect(fitStacked(left, 12).map((p) => `${p.name}:${p.rows}`)).toEqual([
			"SESSION:3",
			"CONTEXT:2",
			"PLAN:1",
		]);
		expect(fitStacked(left, 4).map((p) => `${p.name}:${p.rows}`)).toEqual([
			"SESSION:2",
		]);
	});
	test("the right rail drops COST, then TOKENS, and ACTIVITY takes the rest", () => {
		expect(fitActivity(37, 1, 2)).toEqual({
			activity: 28,
			tokens: true,
			cost: true,
		});
		expect(fitActivity(9, 1, 2)).toEqual({
			activity: 4,
			tokens: true,
			cost: false,
		});
		expect(fitActivity(5, 1, 2)).toEqual({
			activity: 3,
			tokens: false,
			cost: false,
		});
	});
});

describe("globeFrame (spec 0003 AC-16)", () => {
	test("the land mask is 36 rows of 72 cells of # and .", () => {
		expect(LAND_MASK.length).toBe(36);
		for (const row of LAND_MASK) expect(row).toMatch(/^[#.]{72}$/);
	});
	test("frames at 0 and 90 degrees match the committed snapshots", () => {
		expect(GLOBE_TILT_DEG).toBe(23.4);
		expect(globeFrame(0, 28, 14).rows.join("\n")).toMatchSnapshot();
		expect(globeFrame(90, 28, 14).rows.join("\n")).toMatchSnapshot();
	});
	test("every drawn cell has a layer, outline beats land, and none mode drops the graticule", () => {
		const frame = globeFrame(0, 28, 14);
		expect(frame.rows.length).toBe(14);
		frame.rows.forEach((row, y) => {
			[...row].forEach((cell, x) => {
				expect(cell === " ").toBe(frame.layers[y]?.[x] === "none");
			});
		});
		expect(frame.layers.flat()).toContain("outline");
		expect(frame.layers.flat()).toContain("land");
		expect(frame.layers.flat()).toContain("graticule");
		expect(
			globeFrame(0, 28, 14, { graticule: false }).layers.flat(),
		).not.toContain("graticule");
	});
	test("the mask matches a world map: known land is land, open ocean is water", () => {
		const isLand = (lat: number, lon: number) => {
			const row = Math.floor((90 - lat) / 5);
			const col = Math.floor((lon + 180) / 5);
			return LAND_MASK[row]?.[col] === "#";
		};
		const land: ReadonlyArray<readonly [string, number, number]> = [
			["Sahara", 22, 10],
			["Congo", 0, 22],
			["Europe", 50, 10],
			["Siberia", 62, 100],
			["India", 22, 78],
			["China", 32, 105],
			["Australia", -25, 135],
			["Brazil", -10, -52],
			["Argentina", -35, -65],
			["United States", 40, -100],
			["Canada", 58, -110],
			["Greenland", 72, -40],
			["Antarctica", -85, 0],
		];
		const ocean: ReadonlyArray<readonly [string, number, number]> = [
			["central Pacific", 0, -150],
			["North Pacific", 35, -160],
			["South Pacific", -30, -120],
			["North Atlantic", 30, -40],
			["South Atlantic", -30, -15],
			["Indian Ocean", -20, 80],
			["Gulf of Guinea", 0, 0],
			["Arctic Ocean", 87, 0],
		];
		for (const [name, lat, lon] of land)
			expect([name, isLand(lat, lon)]).toEqual([name, true]);
		for (const [name, lat, lon] of ocean)
			expect([name, isLand(lat, lon)]).toEqual([name, false]);
	});
	test("Africa and Europe face you at the start: the center is land at 0 degrees, the Pacific at 180", () => {
		const center = (frame: ReturnType<typeof globeFrame>) =>
			frame.layers[7]?.[14];
		expect(center(globeFrame(0, 28, 14))).toBe("land");
		expect(center(globeFrame(180, 28, 14))).not.toBe("land");
	});
	test("turning changes the frame", () => {
		expect(globeFrame(3, 28, 14).rows).not.toEqual(globeFrame(0, 28, 14).rows);
	});
});

describe("rail fitting at tiny heights (spec 0003 AC-10)", () => {
	const left = [
		{ name: "SESSION", rows: 3 },
		{ name: "CONTEXT", rows: 2 },
	];
	test("no panel draws when only its frame fits, and an empty list stays empty", () => {
		expect(fitStacked(left, 0)).toEqual([]);
		expect(fitStacked(left, 2)).toEqual([]);
		expect(fitStacked(left, 3)).toEqual([{ name: "SESSION", rows: 1 }]);
		expect(fitStacked([], 40)).toEqual([]);
	});
	test("the right rail keeps COST down to one ACTIVITY row, then TOKENS, then ACTIVITY never goes negative", () => {
		expect(fitActivity(10, 1, 2)).toEqual({
			activity: 1,
			tokens: true,
			cost: true,
		});
		expect(fitActivity(6, 1, 2)).toEqual({
			activity: 1,
			tokens: true,
			cost: false,
		});
		expect(fitActivity(1, 1, 2)).toEqual({
			activity: 0,
			tokens: false,
			cost: false,
		});
	});
});

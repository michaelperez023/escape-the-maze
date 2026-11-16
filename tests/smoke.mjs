// Smoke test: serves this folder and opens the game in headless Chrome. It checks that the
// enemies stay in their own mazes. For each level it checks that the exit can be reached
// from the start, then starts the level, moves and shoots. It fails on any console error,
// page error or failed request.
//
//   npm install --no-save puppeteer-core
//   node tests/smoke.mjs
//
// Set CHROME_PATH if Chrome is not in one of the usual places. With SOFTWARE_GL=1 Chrome
// renders WebGL on the CPU (SwiftShader), for machines without a GPU such as CI runners.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(path => path && existsSync(path));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const server = createServer(async (request, response) =>
{
	let path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
	if (path.endsWith("/"))
		path += "index.html";
	try
	{
		const body = await readFile(join(root, path));
		response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
		response.end(body);
	}
	catch
	{
		response.writeHead(404);
		response.end();
	}
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const args = [];
if (process.env.SOFTWARE_GL)
	args.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader");
if (process.env.CI)
	args.push("--no-sandbox");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args });
const problems = [];
let failed = false;
try
{
	const page = await browser.newPage();
	page.on("console", message => { if (message.type() === "error") problems.push("console error: " + message.text()); });
	page.on("pageerror", error => problems.push("page error: " + error.message));
	page.on("requestfailed", request => problems.push("request failed: " + request.url()));
	page.on("response", response => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });
	await page.setViewport({ width: 1280, height: 720 });
	await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
	await page.waitForFunction(() => !document.getElementById("buttonLevel1").disabled, { timeout: 60000 });
	console.log("Loaded:", await page.evaluate(() => `${Object.keys(TEX).length} textures, ${m.walls.blocks.length} wall blocks, ${m.Enemy.size} enemies`));

	//Let the enemies wander for five minutes of game time (18,000 steps), then check that each
	//one is still inside the maze of its own level.
	const strays = await page.evaluate(() =>
	{
		for (let i = 0; i < 18000; i++)
			m.UpdateAll();
		return [...m.Enemy.values()].filter(enemy =>
		{
			const [x0, z0] = LEVELS[enemy.level].cell(0, 0), [x1, z1] = LEVELS[enemy.level].cell(MAZE.length - 1, MAZE[0].length - 1);
			const x = enemy.loc[0], z = enemy.loc[2];
			return x < Math.min(x0, x1) - 1 || x > Math.max(x0, x1) + 1 || z < Math.min(z0, z1) - 1 || z > Math.max(z0, z1) + 1;
		}).length;
	});
	console.log(`After five minutes: ${strays} enemies outside their own maze`);
	if (strays)
		failed = true;

	for (const level of [1, 2, 3])
	{
		//Breadth-first search over player positions 0.25 units apart, using the game's own
		//wall test, from the level's start to its exit.
		const route = await page.evaluate(level =>
		{
			const L = LEVELS[level], step = .25, size = 400, origin = [L.start[0] - 50, L.start[1] - 50];
			const seen = new Uint8Array(size * size), queue = [[200, 200, 0]];
			seen[200 * size + 200] = 1;
			for (let head = 0; head < queue.length; head++)
			{
				const [i, j, distance] = queue[head], x = origin[0] + i * step, z = origin[1] + j * step;
				if (L.escaped(x, z))
					return { reachable: true, distance };
				for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
				{
					const a = i + di, b = j + dj;
					if (a < 0 || b < 0 || a >= size || b >= size || seen[b * size + a])
						continue;
					seen[b * size + a] = 1;
					if (!m.walls.CircleHits(origin[0] + a * step, origin[1] + b * step, PLAYER_RADIUS))
						queue.push([a, b, distance + step]);
				}
			}
			return { reachable: false };
		}, level);
		console.log(`Level ${level}: exit ${route.reachable ? `reachable, ${route.distance} units along the grid` : "NOT reachable"}`);
		if (!route.reachable)
			failed = true;

		await page.click("#buttonLevel" + level);
		await page.keyboard.down("KeyW");
		await sleep(400);
		await page.keyboard.up("KeyW");
		await page.keyboard.press("Space");
		await sleep(300);
		const state = await page.evaluate(() => ({ state: m.state, level: m.currentLevel, x: m.player.loc[0], z: m.player.loc[2],
			inWall: m.walls.CircleHits(m.player.loc[0], m.player.loc[2], PLAYER_RADIUS) }));
		const ok = state.state === "playing" && state.level === level && !state.inWall;
		console.log(`Level ${level}: ${ok ? "ok" : "FAILED"}, player at (${state.x.toFixed(1)}, ${state.z.toFixed(1)})`);
		if (!ok)
			failed = true;
		await page.keyboard.press("Escape");
		if (await page.evaluate(() => m.state) !== "menu")
		{
			console.log("Escape did not return to the title menu");
			failed = true;
		}
	}
}
finally
{
	await browser.close();
	server.close();
}
for (const problem of problems)
	console.log(problem);
if (failed || problems.length)
	process.exit(1);
console.log("No errors.");

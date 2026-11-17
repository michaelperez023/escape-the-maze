// Smoke test: serves this folder and opens the game in headless Chrome. It checks that the
// enemies stay in their own mazes, and that the music is not downloaded before a level starts
// with sound on. Counting the copies of the song that are playing and measuring the game's
// sound output, it checks that one copy plays during a level and keeps playing through the
// completion screen and the next level, that the title menu is silent, that the music resumes
// where it stopped and that nothing plays with sound off. For each level it checks that the
// exit can be reached from the start, then starts the level, moves and shoots. It fails on any
// console error, page error or failed request.
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
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg" };
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
let songRequests = 0;
try
{
	const page = await browser.newPage();
	//The copies of the song that are playing: sources whose buffer is over a minute long, from
	//start() until they end. songOffset is the place in the song where the latest one started.
	await page.evaluateOnNewDocument(() =>
	{
		window.songCopies = new Set();
		window.songOffset = null;
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function(...args)
		{
			start.apply(this, args);
			if (this.buffer && this.buffer.duration > 60)
			{
				window.songOffset = args[1];
				window.songCopies.add(this);
				this.addEventListener("ended", () => window.songCopies.delete(this));
			}
		};
	});
	page.on("request", request => { if (request.url().endsWith("/assets/song.mp3")) songRequests++; });
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

	//The music. sounds.musicPlaying and sounds.musicPosition (seconds into the song) are the
	//game's own view of it; songCopies counts the copies that are really playing, songOffset
	//says where the latest one started, and an AnalyserNode on the game's sound output gives the
	//loudest of its last 32768 samples. The sound effects are muted for these checks, so the
	//output is the music alone.
	await page.evaluate(() => { sounds.Play = () => {}; });
	const music = () => page.evaluate(() => ({ playing: sounds.musicPlaying, position: sounds.musicPosition,
		copies: songCopies.size, offset: songOffset, peak: outputPeak() }));
	const waitFor = (condition, timeout) => page.waitForFunction(condition, { polling: 50, timeout }).then(() => true, () => false);
	const silence = () => waitFor(() => songCopies.size === 0 && outputPeak() === 0, 5000);
	const report = (ok, text) =>
	{
		console.log(`Music: ${text}: ${ok ? "ok" : "FAILED"}`);
		if (!ok)
			failed = true;
	};
	report(songRequests === 0, "song.mp3 not requested before a level starts");
	await page.click("#sound_off");
	await page.click("#buttonLevel1");
	await page.evaluate(() =>
	{
		const analyser = sounds.context.createAnalyser(), samples = new Float32Array(32768);
		analyser.fftSize = samples.length;
		sounds.output.connect(analyser);
		window.outputPeak = () =>
		{
			analyser.getFloatTimeDomainData(samples);
			return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
		};
	});
	await sleep(1000);
	let now = await music();
	report(!now.playing && now.copies === 0 && now.peak === 0 && songRequests === 0, "silent with sound off, song.mp3 still not requested");
	await page.keyboard.press("Escape");
	await page.click("#sound_on");
	await page.click("#buttonLevel1");
	const started = await waitFor(() => sounds.musicPlaying && sounds.context.state === "running", 30000);
	const first = await music();
	await sleep(1500);
	const playing = await music();
	report(started && songRequests === 1 && playing.copies === 1 && playing.peak > .001 && playing.position - first.position > 1,
		`one copy playing with sound on in a running AudioContext, ${first.position.toFixed(2)} s to ${playing.position.toFixed(2)} s into the song, ` +
		`peak ${(20 * Math.log10(playing.peak)).toFixed(0)} dBFS`);
	await page.keyboard.press("Escape");
	const paused = await music();
	const silent = await silence();
	report(!paused.playing && paused.position >= playing.position && paused.position < playing.position + 1 && silent && (await music()).position === paused.position,
		`Esc to the title menu pauses it at ${paused.position.toFixed(2)} s and silences it`);
	await page.click("#buttonLevel2");
	const resumed = (await waitFor(() => sounds.musicPlaying, 10000)) && await music();
	await sleep(1000);
	now = await music();
	//The new copy must start where the old one paused. The position is worked out from the
	//AudioContext's clock, so allow for rounding.
	report(resumed && resumed.offset === paused.position && resumed.position > paused.position - .001 && resumed.position < paused.position + 1 &&
		now.copies === 1 && now.peak > .001,
		`starting a level resumes it at ${resumed ? resumed.position.toFixed(2) : "-"} s`);
	await page.evaluate(() => m.LevelComplete());
	await sleep(500);
	const complete = await music();
	await page.click("#nextLevel");
	await sleep(1000);
	now = await music();
	report(complete.playing && complete.copies === 1 && now.playing && now.copies === 1 && now.peak > .001 && now.position > complete.position,
		`one copy keeps playing through the completion screen and Next level, at ${now.position.toFixed(2)} s`);
	await page.keyboard.press("Escape");
	await silence();
	await page.click("#sound_off");
	await page.click("#buttonLevel3");
	await sleep(1000);
	report(!(await music()).playing && await silence() && songRequests === 1, "silent with sound off after it has loaded");
	await page.keyboard.press("Escape");
	await page.click("#sound_on");
	await page.evaluate(() => { delete sounds.Play; });

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
catch (error)
{
	//Recorded so that the console and page errors collected so far are printed with it.
	problems.push("test step failed: " + error.stack);
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

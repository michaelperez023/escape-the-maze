// Textures. The character and wall images are PNG files in assets/, decoded pixel for pixel
// from the arrays the 2020 version kept in BasicGameObject.js. The grass, the ink splatter
// and the explosion are drawn below when the page loads. Each texture is uploaded to the
// GPU once and shared by every object that uses it.

var TEX = {};

var TEXTURE_FILES = ["goomba1", "goomba2", "goomba3", "koopa1", "koopa2", "koopa3",
	"bobomb1", "bobomb2", "bobomb3", "shell", "fireball", "banana", "brick", "rock"];

function LoadTextures()
{
	const images = TEXTURE_FILES.map(name => new Promise((resolve, reject) =>
	{
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not load assets/" + name + ".png."));
		image.src = "assets/" + name + ".png";
	}));
	return Promise.all(images).then(loaded =>
	{
		//Upload the stored bytes unchanged: no colour conversion and no premultiplied alpha.
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		loaded.forEach((image, i) => { TEX[TEXTURE_FILES[i]] = CreateTexture(image); });
		TEX.grass = CreateTexture(DrawGrass());
		TEX.splatter = CreateTexture(DrawSplatter());
		TEX.explosion = CreateTexture(DrawExplosion());
	});
}

//source is an <img> or a PixelImage. All textures are 16 or 256 pixels square, so they can repeat.
function CreateTexture(source)
{
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	if (source instanceof PixelImage)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.size, source.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
	else
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	return texture;
}

//A square RGBA image with simple drawing operations. Pixels are either opaque or fully
//transparent, because the fragment shader discards anything that is not opaque.
class PixelImage
{
	constructor(size)
	{
		this.size = size;
		this.data = new Uint8Array(size * size * 4);
	}

	//Coordinates outside the image wrap around, so shapes drawn near an edge tile seamlessly.
	Set(x, y, rgb)
	{
		const s = this.size, i = ((((y % s) + s) % s) * s + (((x % s) + s) % s)) * 4;
		this.data[i] = rgb[0];
		this.data[i + 1] = rgb[1];
		this.data[i + 2] = rgb[2];
		this.data[i + 3] = 255;
	}

	FillCircle(cx, cy, r, rgb)
	{
		for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
			for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
				if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r)
					this.Set(x, y, rgb);
	}

	//Scanline fill of a polygon given as [[x, y], ...], sampled at pixel centres.
	FillPolygon(points, rgb)
	{
		const ys = points.map(p => p[1]);
		for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
		{
			const py = y + .5, xs = [];
			points.forEach(([x1, y1], i) =>
			{
				const [x2, y2] = points[(i + 1) % points.length];
				if ((y1 <= py) !== (y2 <= py))
					xs.push(x1 + (py - y1) / (y2 - y1) * (x2 - x1));
			});
			xs.sort((a, b) => a - b);
			for (let k = 0; k + 1 < xs.length; k += 2)
				for (let x = Math.ceil(xs[k] - .5); x <= Math.floor(xs[k + 1] - .5); x++)
					this.Set(x, y, rgb);
		}
	}
}

//Seeded random numbers (mulberry32), so the drawn textures are the same every time.
function SeededRandom(seed)
{
	return function ()
	{
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

//Adds weight * smooth value noise to out (size x size). The noise is interpolated from a
//cells x cells grid of random values that wraps around, so the result tiles seamlessly.
function AddTileableNoise(out, size, cells, weight, random)
{
	const lattice = new Float32Array(cells * cells).map(random), step = cells / size;
	for (let y = 0; y < size; y++)
	{
		const v = y * step, j = Math.floor(v), fv = v - j, sv = fv * fv * (3 - 2 * fv);
		const row0 = j * cells, row1 = ((j + 1) % cells) * cells;
		for (let x = 0; x < size; x++)
		{
			const u = x * step, i = Math.floor(u), fu = u - i, su = fu * fu * (3 - 2 * fu), i1 = (i + 1) % cells;
			const top = lattice[row0 + i] + (lattice[row0 + i1] - lattice[row0 + i]) * su;
			const bottom = lattice[row1 + i] + (lattice[row1 + i1] - lattice[row1 + i]) * su;
			out[y * size + x] += weight * (top + (bottom - top) * sv);
		}
	}
}

//Bright green grass with soft patches, short blades and a few pale specks. It tiles seamlessly.
function DrawGrass()
{
	const size = 256, image = new PixelImage(size), random = SeededRandom(2020), noise = new Float32Array(size * size);
	for (const [cells, weight] of [[4, .45], [8, .25], [16, .18], [64, .12]])
		AddTileableNoise(noise, size, cells, weight, random);
	for (let k = 0; k < size * size; k++)
	{
		const shade = .8 + .4 * noise[k];
		image.data[4 * k] = Math.round(52 * shade);
		image.data[4 * k + 1] = Math.round(212 * shade);
		image.data[4 * k + 2] = Math.round(6 * shade);
		image.data[4 * k + 3] = 255;
	}
	for (let i = 0; i < 900; i++)
	{
		const x = Math.floor(random() * size), y = Math.floor(random() * size), length = 1 + Math.floor(random() * 3);
		const color = random() < .5 ? [40, 176, 0] : [74, 226, 18];
		for (let k = 0; k < length; k++)
			image.Set(x, y - k, color);
	}
	for (let i = 0; i < 60; i++)
	{
		const cx = random() * size, cy = random() * size;
		for (let k = 0; k < 6; k++)
			image.Set(Math.floor(cx + (random() - .5) * 14), Math.floor(cy + (random() - .5) * 14), [150, 240, 84]);
	}
	return image;
}

//A blot of dark ink with streaks and drops thrown out of it.
function DrawSplatter()
{
	const size = 256, c = size / 2, image = new PixelImage(size), random = SeededRandom(7), ink = [20, 16, 30];
	const phase = [random(), random(), random()].map(v => v * 2 * Math.PI), blob = [];
	for (let i = 0; i < 96; i++)
	{
		const a = i / 96 * 2 * Math.PI;
		const r = 34 + 4 * Math.sin(2 * a + phase[0]) + 4 * Math.sin(5 * a + phase[1]) + 2.5 * Math.sin(9 * a + phase[2]);
		blob.push([c + r * Math.cos(a), c + r * Math.sin(a)]);
	}
	image.FillPolygon(blob, ink);
	for (let i = 0; i < 6; i++)
	{
		const a = (i + random()) / 6 * 2 * Math.PI, d = 22 + random() * 10;
		image.FillCircle(c + d * Math.cos(a), c + d * Math.sin(a), 13 + random() * 7, ink);
	}
	for (let i = 0; i < 14; i++)
	{
		const a = random() * 2 * Math.PI, inner = 26, outer = 50 + random() * 50, w = 2 + random() * 4;
		const ca = Math.cos(a), sa = Math.sin(a);
		image.FillPolygon([[c + inner * ca - w * sa, c + inner * sa + w * ca], [c + outer * ca, c + outer * sa],
			[c + inner * ca + w * sa, c + inner * sa - w * ca]], ink);
		image.FillCircle(c + (outer + w) * ca, c + (outer + w) * sa, w * .9, ink);
	}
	for (let i = 0; i < 60; i++)
	{
		const a = random() * 2 * Math.PI, d = 44 + random() * 76;
		image.FillCircle(c + d * Math.cos(a), c + d * Math.sin(a), 1 + random() * Math.max(1, 7 - d / 20), ink);
	}
	return image;
}

//A comic-style starburst: dark red rim, then red, orange and yellow layers and a pale centre.
function DrawExplosion()
{
	const size = 256, c = size / 2, image = new PixelImage(size), random = SeededRandom(11), spikes = 14;
	const outer = [], inner = [], jitter = [];
	for (let i = 0; i < spikes; i++)
	{
		outer.push(100 + random() * 24);
		inner.push(52 + random() * 18);
		jitter.push((random() - .5) * .25);
	}
	const star = scale =>
	{
		const points = [];
		for (let i = 0; i < spikes; i++)
		{
			const a = (i + jitter[i]) / spikes * 2 * Math.PI, b = (i + .5) / spikes * 2 * Math.PI;
			points.push([c + outer[i] * scale * Math.cos(a), c + outer[i] * scale * Math.sin(a)]);
			points.push([c + inner[i] * scale * Math.cos(b), c + inner[i] * scale * Math.sin(b)]);
		}
		return points;
	};
	image.FillPolygon(star(1), [176, 0, 0]);
	image.FillPolygon(star(.9), [255, 32, 0]);
	image.FillPolygon(star(.68), [255, 150, 0]);
	image.FillPolygon(star(.48), [255, 236, 0]);
	image.FillCircle(c, c, 20, [255, 252, 170]);
	return image;
}

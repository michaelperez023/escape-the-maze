// The game: object lists, levels, input, the on-screen text and the main loop. The object
// lists, CreateObject/DestroyObject and the update/render loop follow the course's WebGL
// texture example (SimpleTextureExample).

var STEP_MS = 1000/60;    //the game logic runs 60 steps per second on every display

//Keyboard keys by physical position (KeyboardEvent.code), so other layouts work too.
var KEY_ACTIONS = {
	KeyW: "forward", ArrowUp: "forward",
	KeyS: "back", ArrowDown: "back",
	KeyA: "left", ArrowLeft: "left",
	KeyD: "right", ArrowRight: "right",
	KeyZ: "strafeLeft",
	KeyX: "strafeRight",
	Space: "shoot"
};
var ACTIONS = ["forward", "back", "left", "right", "strafeLeft", "strafeRight", "shoot"];

class main
{
	constructor()
	{
		this.Enemy = new Map();
		this.Solid = new Map();
		this.Camera = new Map();
		this.Moving = new Map();
		this.Ground = new Map();
		this.ObjectCounter = 0;

		this.myWEBGL = new WebGL_Interface();
		this.walls = new Walls();
		this.Keys = {};            //actions whose key is held down
		this.Tapped = {};          //actions pressed since the last step, so short taps still count
		this.Input = {};           //what the current step acts on
		this.state = "loading";    //loading, menu, playing or complete
		this.currentLevel = 0;
		this.currentMovementSpeed = 0.25;
		this.currentRotationSpeed = 0.05;
		this.currentCharacterProjectile = 1;

		this.steps = 0;            //game steps since the page loaded
		this.levelStartStep = 0;
		this.messageUntil = 0;
		this.lastFrame = null;
		this.unsimulated = 0;      //milliseconds not yet simulated
		Quad.CreateBuffer();
		gl.uniform3fv(this.myWEBGL.uniform.lights, new Float32Array(LIGHTS.flat()));
	}

	//Builds the three copies of the maze and their enemies.
	BuildWorld()
	{
		this.CreateObject(4, Ground, [0,-1,0], [0,0,0], 0);
		this.player = this.CreateObject(2, Camera, [30,5,30], [0,4.5,0], PLAYER_HP);
		for(var level = 1; level <= 3; level++)
		{
			for(var row = 0; row < MAZE.length; row++)
			{
				for(var col = 0; col < MAZE[row].length; col++)
				{
					var cell = MAZE[row][col];
					if(cell == 1 || cell == 2)
					{
						var [x, z] = LEVELS[level].cell(row, col);
						var block = this.CreateObject(1, Block, [x,0,z], [0,0,0], 0);
						if(cell == 2)
							block.ChangeToRock();
						this.walls.Add(block);
					}
				}
			}
			this.SpawnEnemies(level);
		}
		this.walls.Build();
	}

	//Puts a level's enemies back at their starting cells with full health.
	SpawnEnemies(level)
	{
		for(var enemy of this.Enemy.values())
		{
			if(enemy.level == level)
				this.DestroyObject(enemy.id);
		}
		var hp = LEVELS[level].hp;
		for(var row = 0; row < MAZE.length; row++)
		{
			for(var col = 0; col < MAZE[row].length; col++)
			{
				var cell = MAZE[row][col];
				if(cell < 4)
					continue;
				var [x, z] = LEVELS[level].cell(row, col);
				var quad = this.CreateObject(0, Quad, [x,0,z], [0,0,0], 0);
				quad.level = level;
				if(cell == 4)
					quad.ChangeToGoomba(hp.goomba);
				else if(cell == 5)
					quad.ChangeToBobomb(hp.bobomb);
				else if(cell == 6)
					quad.ChangeToKoopa(hp.koopa);
			}
		}
	}

	UpdateAll()
	{
		this.steps++;
		this.Input = {};
		for(var action of ACTIONS)
			this.Input[action] = Boolean(this.Keys[action] || this.Tapped[action]);
		this.Tapped = {};
		for(var enemy of this.Enemy.values())
			enemy.Update();
		for(var camera of this.Camera.values())
			camera.Update();
		for(var moving of this.Moving.values())
			moving.Update();
		if(this.messageUntil && this.steps >= this.messageUntil)
			this.ShowMessage("");
	}

	RenderAll()
	{
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		var webgl = this.myWEBGL;
		for(var camera of this.Camera.values())
			camera.Render(webgl);
		for(var ground of this.Ground.values())
			ground.Render(webgl);
		this.walls.Render(webgl);
		Quad.BeginRender(webgl);
		for(var enemy of this.Enemy.values())
			enemy.Render(webgl);
		for(var moving of this.Moving.values())
			moving.Render(webgl);
		Quad.EndRender(webgl);
	}

	StartLevel(level)
	{
		if(this.state == "loading")
			return;
		sounds.Unlock();
		this.ClearShots();
		this.SpawnEnemies(level);
		this.currentLevel = level;
		this.PlacePlayerAtStart();
		this.levelStartStep = this.steps;
		this.state = "playing";
		this.ClearKeys();
		ui.titleMenu.hidden = true;
		ui.levelComplete.hidden = true;
		ui.hud.hidden = false;
		ui.levelLabel.textContent = "Level " + level;
		this.ShowMessage("Find the way out!");
		this.UpdateHUD();
		//Keep keyboard focus off the buttons, or Space would press them again.
		canvas.focus();
	}
	PlacePlayerAtStart()
	{
		var level = LEVELS[this.currentLevel];
		this.player.loc = [level.start[0], 0, level.start[1]];
		this.player.rot = [0, level.heading, 0];
		this.player.hp = PLAYER_HP;
		this.player.wait = 20;
		//A second's grace, in case an enemy has wandered onto the start.
		this.player.safeUntil = this.steps + 60;
	}

	//Touching an enemy or running out of health sends the player back to the start.
	Respawn(message)
	{
		this.ClearShots();
		this.PlacePlayerAtStart();
		this.ShowMessage(message);
		this.UpdateHUD();
	}

	LevelComplete()
	{
		this.state = "complete";
		this.ClearKeys();
		var seconds = (this.steps - this.levelStartStep)/60;
		ui.completeTitle.textContent = "Level " + this.currentLevel + " completed!";
		ui.completeText.textContent = "Time " + Math.floor(seconds/60) + ":" + String(Math.floor(seconds%60)).padStart(2, "0") +
			(this.currentLevel == 3 ? ". You escaped all three mazes!" : ". The next maze has tougher enemies.");
		ui.nextLevel.hidden = this.currentLevel == 3;
		ui.levelComplete.hidden = false;
		this.ShowMessage("");
	}

	BackToTitleMenu()
	{
		if(this.state == "loading" || this.state == "menu")
			return;
		this.state = "menu";
		this.currentLevel = 0;
		this.ClearShots();
		this.ClearKeys();
		this.player.loc = [30,5,30];
		this.player.rot = [0,4.5,0];
		ui.hud.hidden = true;
		ui.levelComplete.hidden = true;
		ui.titleMenu.hidden = false;
		ui.tagline.textContent = "Good luck this time around, it gets harder and harder";
		if(document.activeElement)
			document.activeElement.blur();
	}

	ChangeMovementSpeed(value)
	{
		this.currentMovementSpeed = Number(value);
	}
	ChangeRotationSpeed(value)
	{
		this.currentRotationSpeed = Number(value);
	}
	ChangeCharacterProjectile(value)
	{
		this.currentCharacterProjectile = Number(value);
	}

	CreateObject(type, prefab, loc, rot, hp)
	{
		//type 0 = Enemy
		//type 1 = solid
		//type 2 = Camera
		//type 3 = Moving
		//type 4 = Ground
		var temp = new prefab;
		var id = "ID"+this.ObjectCounter;
		this.ObjectCounter++;
		temp.id = id;
		temp.prefab = prefab;
		temp.loc = loc;
		temp.rot = rot;
		temp.hp = hp;
		[this.Enemy, this.Solid, this.Camera, this.Moving, this.Ground][type].set(id, temp);
		return temp;
	}

	DestroyObject(id)
	{
		for(var list of [this.Enemy, this.Solid, this.Camera, this.Moving, this.Ground])
			list.delete(id);
	}

	//Removes every projectile and shell.
	ClearShots()
	{
		this.Moving.clear();
	}

	//Sounds fade out with distance from the player.
	VolumeAt(object)
	{
		return Math.max(0, 1 - this.player.Distance(object)/30);
	}

	ShowMessage(text)
	{
		ui.result.textContent = text;
		this.messageUntil = text ? this.steps + 150 : 0;
	}
	UpdateHUD()
	{
		var hp = Math.max(this.player.hp, 0);
		//Filled and empty hearts, drawn as text rather than emoji (U+FE0E).
		ui.hp.textContent = "\u2665\uFE0E".repeat(hp) + "\u2661\uFE0E".repeat(PLAYER_HP - hp);
		ui.hp.setAttribute("aria-label", "Health " + hp + " of " + PLAYER_HP);
	}

	KeyDown(event)
	{
		if(event.code == "Escape")
		{
			this.BackToTitleMenu();
			return;
		}
		//A button the player moved to with Tab keeps its usual keys.
		var onButton = event.target instanceof HTMLButtonElement;
		if(event.code == "Enter" && this.state == "complete" && !onButton)
		{
			event.preventDefault();
			if(this.currentLevel < 3)
				this.StartLevel(this.currentLevel + 1);
			else
				this.BackToTitleMenu();
			return;
		}
		var action = KEY_ACTIONS[event.code];
		if(!action)
			return;
		//Stop Space and the arrow keys from scrolling the page or pressing a button.
		if(this.state == "playing" || (this.state == "complete" && !onButton))
			event.preventDefault();
		if(this.state == "playing")
		{
			this.Keys[action] = true;
			this.Tapped[action] = true;
		}
	}
	KeyUp(event)
	{
		var action = KEY_ACTIONS[event.code];
		if(!action)
			return;
		this.Keys[action] = false;
		if(this.state == "playing" || (this.state == "complete" && !(event.target instanceof HTMLButtonElement)))
			event.preventDefault();
	}
	ClearKeys()
	{
		this.Keys = {};
		this.Tapped = {};
	}

	//Draws at the screen's pixel density, but at most about 1920 x 1080 pixels in all, so that
	//integrated graphics keep up on large and high-density screens; the browser scales the rest.
	Resize()
	{
		var area = Math.max(canvas.clientWidth*canvas.clientHeight, 1);
		var ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(1920*1080/area));
		var width = Math.max(1, Math.round(canvas.clientWidth*ratio));
		var height = Math.max(1, Math.round(canvas.clientHeight*ratio));
		if(canvas.width != width || canvas.height != height)
		{
			canvas.width = width;
			canvas.height = height;
		}
		this.myWEBGL.Resize(width, height);
	}

	//Static call backs
	static keyD(event)
	{
		m.KeyDown(event);
	}
	static keyU(event)
	{
		m.KeyUp(event);
	}
	//Runs as many fixed 1/60 s steps as real time has passed, then draws one frame.
	static MainLoop(now)
	{
		if(m.lastFrame === null)
			m.lastFrame = now;
		m.unsimulated += Math.min(now - m.lastFrame, 250);
		m.lastFrame = now;
		if(m.state != "loading")
		{
			while(m.unsimulated >= STEP_MS)
			{
				m.UpdateAll();
				m.unsimulated -= STEP_MS;
			}
		}
		else
			m.unsimulated = 0;
		m.RenderAll();
		requestAnimationFrame(main.MainLoop);
	}
}

var canvas = document.getElementById("myCanvas");
//No multisampling: it cost more than the rest of the drawing on large screens, and the
//nearest-neighbour textures already give the game a pixelated look.
var gl = canvas.getContext("webgl", { antialias: false }) || canvas.getContext("experimental-webgl", { antialias: false });
var m = null;
var ui = {};
for(const id of ["titleMenu", "tagline", "status", "touchNotice", "hud", "levelLabel", "hp", "result",
	"backToTitleMenu", "levelComplete", "completeTitle", "completeText", "nextLevel", "completeMenu"])
	ui[id] = document.getElementById(id);

function ShowError(text)
{
	ui.status.textContent = text;
	ui.status.hidden = false;
	ui.status.classList.add("error");
}

function Start()
{
	//Phones and tablets without a keyboard cannot play, so say so up front.
	ui.touchNotice.hidden = !(window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches);
	if(!gl)
	{
		ShowError("This browser could not start WebGL, which the game needs.");
		return;
	}
	try
	{
		m = new main();
	}
	catch(error)
	{
		ShowError(error.message);
		return;
	}
	m.Resize();
	window.addEventListener("resize", () => m.Resize());
	window.addEventListener("keydown", main.keyD);
	window.addEventListener("keyup", main.keyU);
	window.addEventListener("blur", () => m.ClearKeys());

	for(let level = 1; level <= 3; level++)
		document.getElementById("buttonLevel" + level).addEventListener("click", () => m.StartLevel(level));
	ui.nextLevel.addEventListener("click", () => m.StartLevel(m.currentLevel + 1));
	ui.completeMenu.addEventListener("click", () => m.BackToTitleMenu());
	ui.backToTitleMenu.addEventListener("click", () => m.BackToTitleMenu());
	const options = {
		movement_speed: value => m.ChangeMovementSpeed(value),
		rotation_speed: value => m.ChangeRotationSpeed(value),
		character_projectile: value => m.ChangeCharacterProjectile(value),
		sound: value => { sounds.enabled = value == "on"; }
	};
	for(const input of document.querySelectorAll("#titleMenu input[type=radio]"))
	{
		input.addEventListener("change", () => options[input.name](input.value));
		if(input.checked)
			options[input.name](input.value);
	}

	requestAnimationFrame(main.MainLoop);
	LoadTextures().then(() =>
	{
		m.BuildWorld();
		m.state = "menu";
		ui.status.hidden = true;
		for(const button of document.querySelectorAll("#titleMenu .levels button"))
			button.disabled = false;
	}).catch(error =>
	{
		ShowError(location.protocol == "file:"
			? "The textures cannot be loaded from a file:// page. Serve this folder over HTTP instead, for example with \"python3 -m http.server\", and open the address it prints."
			: "The game could not start: " + error.message);
	});
}

Start();

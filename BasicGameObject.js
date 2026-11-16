// Game objects: the player (Camera), enemies, projectiles and explosions (Quad), wall cubes
// (Block and Walls) and the Ground. Transform, GameObject and the drawing code are based on
// the course's WebGL texture example (SimpleTextureExample).

//Sizes in world units (a maze cell is 2 x 2). Collisions are tested in the x-z plane.
var PLAYER_RADIUS = .4;    //the player's body: walls, enemies and shells
var ENEMY_RADIUS = .8;     //enemies are drawn 2 units wide
var SHOT_RADIUS = .2;      //fireballs, splatters, bananas and shells
var SHOT_SPEED = .1;       //units per step
var SHOT_LIFETIME = 600;   //steps (10 s) before a projectile that hit nothing disappears
var KOOPA_RANGE = 30;      //Koopas only throw shells at a player this close
var PLAYER_HP = 5;
var ENEMY_NAMES = ["Goomba", "Koopa", "Bob-omb"];

class Transform
{
	constructor()
	{
		this.forward = [0,0,1];
		this.right = [1,0,0];
		this.up = [0,1,0];
	}

	doRotations(RotAngles)
	{
		this.xRot = [
					[1,0,0,0],
					[0,Math.cos(RotAngles[0]),-1*Math.sin(RotAngles[0]),0],
					[0,Math.sin(RotAngles[0]),Math.cos(RotAngles[0]),0],
					[0,0,0,1]
				];
		this.yRot = [
				[Math.cos(RotAngles[1]),0,Math.sin(RotAngles[1]),0],
				[0,1,0,0],
				[-1*Math.sin(RotAngles[1]),0,Math.cos(RotAngles[1]),0],
				[0,0,0,1]
				];
		this.zRot = [
					[Math.cos(RotAngles[2]),-1*Math.sin(RotAngles[2]),0,0],
					[Math.sin(RotAngles[2]),Math.cos(RotAngles[2]),0,0],
					[0,0,1,0],
					[0,0,0,1]
				];
		this.forward = this.crossMultiply(this.zRot,this.crossMultiply(this.yRot,this.crossMultiply(this.xRot,[0,0,1,0])));
		this.right = this.crossMultiply(this.zRot,this.crossMultiply(this.yRot,this.crossMultiply(this.xRot,[1,0,0,0])));
		this.up = this.crossMultiply(this.zRot,this.crossMultiply(this.yRot,this.crossMultiply(this.xRot,[0,1,0,0])));
	}
	crossMultiply(M,V)
	{
		var temp = [
					M[0][0]*V[0]+M[0][1]*V[1]+M[0][2]*V[2]+M[0][3]*V[3],
					M[1][0]*V[0]+M[1][1]*V[1]+M[1][2]*V[2]+M[1][3]*V[3],
					M[2][0]*V[0]+M[2][1]*V[1]+M[2][2]*V[2]+M[2][3]*V[3],
					M[3][0]*V[0]+M[3][1]*V[1]+M[3][2]*V[2]+M[3][3]*V[3]
					];
		return temp;
	}
}

class GameObject
{
	constructor()
	{
		this.loc = [0,0,0];    //world position; y is up and everything moves on the floor at y = 0
		this.rot = [0,0,0];
		this.velocity = [0,0,0];
		this.name = "default";
		this.id = 0;
		this.prefab = null;
		this.transform = new Transform();
	}

	//Distance to another object in the x-z plane.
	Distance(other)
	{
		var dx = this.loc[0] - other.loc[0];
		var dz = this.loc[2] - other.loc[2];
		return Math.sqrt(dx*dx + dz*dz);
	}
	Touches(other, range)
	{
		return this.Distance(other) < range;
	}
	Update()
	{
		console.error(this.name + " update() is NOT IMPLEMENTED!");
	}
	Render(webgl)
	{
		console.error(this.name + " render() is NOT IMPLEMENTED!");
	}
}

class Ground extends GameObject
{
	constructor()
	{
		super();
		this.name = "Ground";
		this.buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		//One big square; the grass texture repeats every 20 units.
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		//  X     Y  Z      s    t
			-1000,0,-1000,  0,   0,
			1000, 0,-1000,  100, 0,
			-1000,0,1000,   0,   100,
			1000, 0,1000,   100, 100
		]), gl.STATIC_DRAW);
	}
	Update()
	{
		//Do Nothing
	}
	Render(webgl)
	{
		var stride = 5*Float32Array.BYTES_PER_ELEMENT;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.vertexAttribPointer(webgl.attrib.a_position, 3, gl.FLOAT, false, stride, 0);
		gl.vertexAttribPointer(webgl.attrib.texcord, 2, gl.FLOAT, false, stride, 3*Float32Array.BYTES_PER_ELEMENT);
		gl.bindTexture(gl.TEXTURE_2D, TEX.grass);
		gl.uniform3fv(webgl.uniform.transform, this.loc);
		gl.uniform3fv(webgl.uniform.rotation, this.rot);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
}

//The player. The view is drawn from its position and heading (rot[1]).
class Camera extends GameObject
{
	constructor()
	{
		super();
		this.name = "Camera";
		this.wait = 20;
		this.hp = PLAYER_HP;
		this.safeUntil = 0;    //enemies cannot touch the player before this step
	}
	Update()
	{
		if(m.state == "menu")
		{
			this.rot[1] += .002;    //turn slowly behind the title menu
			return;
		}
		if(m.state != "playing")
			return;

		var keys = m.Input;
		var speed = m.currentMovementSpeed;
		if(keys.left)
			this.rot[1] -= m.currentRotationSpeed;
		if(keys.right)
			this.rot[1] += m.currentRotationSpeed;

		//Transform's vectors have the opposite z sign to the world's: at heading 0 its forward
		//is +z, but the view looks along -z. So z is flipped below.
		this.transform.doRotations(this.rot);
		var f = this.transform.forward;
		var r = this.transform.right;
		var deltaX = 0;
		var deltaZ = 0;
		if(keys.forward)
		{
			deltaX += f[0]*speed;
			deltaZ -= f[2]*speed;
		}
		if(keys.back)
		{
			deltaX -= f[0]*speed;
			deltaZ += f[2]*speed;
		}
		if(keys.strafeLeft)
		{
			deltaX -= r[0]*speed;
			deltaZ += r[2]*speed;
		}
		if(keys.strafeRight)
		{
			deltaX += r[0]*speed;
			deltaZ -= r[2]*speed;
		}
		this.Move2(deltaX, deltaZ);

		//shoot
		this.wait += 1;
		if(keys.shoot && this.wait >= 20)
		{
			var bullet = m.CreateObject(3, Quad, [this.loc[0], 0, this.loc[2]], [0,0,0], 0);
			bullet.ChangeToProjectile(m.currentCharacterProjectile);
			bullet.velocity = [f[0]*SHOT_SPEED, 0, -f[2]*SHOT_SPEED];
			this.wait = 0;
		}

		for(var enemy of m.Enemy.values())
		{
			if(enemy.cat <= 2 && m.steps >= this.safeUntil && this.Touches(enemy, PLAYER_RADIUS + ENEMY_RADIUS))
			{
				m.Respawn("A " + ENEMY_NAMES[enemy.cat] + " got you! Back to the start.");
				return;
			}
		}
		if(this.hp <= 0)
		{
			m.Respawn("Out of health! Back to the start.");
			return;
		}
		if(LEVELS[m.currentLevel].escaped(this.loc[0], this.loc[2]))
			m.LevelComplete();
	}

	//Moves by (deltaX, deltaZ). If a wall is in the way, slides along it instead of stopping.
	Move2(deltaX, deltaZ)
	{
		var x = this.loc[0];
		var z = this.loc[2];
		if(!m.walls.CircleHits(x + deltaX, z + deltaZ, PLAYER_RADIUS))
		{
			this.loc[0] = x + deltaX;
			this.loc[2] = z + deltaZ;
		}
		else if(!m.walls.CircleHits(x + deltaX, z, PLAYER_RADIUS))
			this.loc[0] = x + deltaX;
		else if(!m.walls.CircleHits(x, z + deltaZ, PLAYER_RADIUS))
			this.loc[2] = z + deltaZ;
	}

	//A Koopa shell hit the player.
	Hit()
	{
		this.hp--;
		m.UpdateHUD();
	}

	Render(webgl)
	{
		gl.uniform3fv(webgl.uniform.worldLoc, this.loc);
		gl.uniform3fv(webgl.uniform.worldRotation, this.rot);
	}
}

//A sprite that always faces the camera: an enemy, a projectile or an explosion.
class Quad extends GameObject
{
	constructor()
	{
		super();
		this.name = "Quad";
		this.cat = 0;          //0 Goomba, 1 Koopa, 2 Bob-omb, 3 player projectile, 4 Koopa shell, 5 explosion
		this.level = 0;        //the level whose maze an enemy belongs to
		this.age = 0;          //steps since it was created
		this.shellWait = 0;
		this.cooldown = 30;    //steps an explosion stays on screen
		this.frames = null;    //animation frames and steps per frame
		this.frameSteps = 0;
		this.frame = 0;
		this.frameTime = 0;
		this.scale = 1;
		this.velocity = [0,0,.05];
		this.MyTexture = null;
	}

	//One vertex buffer shared by every sprite.
	static CreateBuffer()
	{
		Quad.buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, Quad.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			//X  Y  Z  S  T
			-1, -1, 0, 0, 1,
			1,  -1, 0, 1, 1,
			-1,  1, 0, 0, 0,
			1,   1, 0, 1, 0
		]), gl.STATIC_DRAW);
	}
	static BeginRender(webgl)
	{
		var stride = 5*Float32Array.BYTES_PER_ELEMENT;
		gl.bindBuffer(gl.ARRAY_BUFFER, Quad.buffer);
		gl.vertexAttribPointer(webgl.attrib.a_position, 3, gl.FLOAT, false, stride, 0);
		gl.vertexAttribPointer(webgl.attrib.texcord, 2, gl.FLOAT, false, stride, 3*Float32Array.BYTES_PER_ELEMENT);
		gl.uniform3f(webgl.uniform.rotation, 0, 0, 0);
		gl.uniform1i(webgl.uniform.FaceCam, 1);
	}
	static EndRender(webgl)
	{
		gl.uniform1i(webgl.uniform.FaceCam, 0);
		gl.uniform1f(webgl.uniform.scale, 1);
	}
	Render(webgl)
	{
		gl.bindTexture(gl.TEXTURE_2D, this.MyTexture);
		gl.uniform3fv(webgl.uniform.transform, this.loc);
		gl.uniform1f(webgl.uniform.scale, this.scale);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	Update()
	{
		this.age++;
		this.Animate();
		if(this.cat == 1)
			this.ThrowShell();
		this.Move();
		if(this.cat <= 2 && this.hp <= 0)
			this.ChangeToExplosion();
		else if(this.cat == 5 && --this.cooldown <= 0)
			m.DestroyObject(this.id);
	}

	Move()
	{
		var x = this.loc[0] + this.velocity[0];
		var z = this.loc[2] + this.velocity[2];
		if(this.cat == 0) //goomba: walks back and forth and turns around at walls
		{
			if(this.Blocked(x, z))
				this.velocity[2] = -this.velocity[2];
			else
				this.SetPosition(x, z);
		}
		else if(this.cat == 1 || this.cat == 2) //koopa or bobomb: wanders and turns away from walls and the exit
		{
			if(this.Blocked(x, z))
				this.velocity = this.FreeDirection();
			else
				this.SetPosition(x, z);
		}
		else if(this.cat == 3) //player projectile: breaks on walls, hurts the first enemy it touches
		{
			if(this.age > SHOT_LIFETIME || m.walls.CircleHits(x, z, SHOT_RADIUS))
			{
				m.DestroyObject(this.id);
				return;
			}
			this.SetPosition(x, z);
			for(var enemy of m.Enemy.values())
			{
				if(enemy.cat <= 2 && this.Touches(enemy, ENEMY_RADIUS + SHOT_RADIUS))
				{
					enemy.hp--;
					sounds.Play(PlayFireCrackle, m.VolumeAt(this));
					m.DestroyObject(this.id);
					return;
				}
			}
		}
		else if(this.cat == 4) //shell: breaks on walls, costs the player 1 HP
		{
			if(this.age > SHOT_LIFETIME)
			{
				m.DestroyObject(this.id);
				return;
			}
			if(m.walls.CircleHits(x, z, SHOT_RADIUS))
			{
				sounds.Play(PlayShellRicochet, m.VolumeAt(this));
				m.DestroyObject(this.id);
				return;
			}
			this.SetPosition(x, z);
			if(m.state == "playing" && this.Touches(m.player, PLAYER_RADIUS + SHOT_RADIUS))
			{
				m.player.Hit();
				sounds.Play(PlayShellRicochet, 1);
				m.DestroyObject(this.id);
			}
		}
	}
	SetPosition(x, z)
	{
		this.loc[0] = x;
		this.loc[2] = z;
	}

	//Is an enemy at (x, z) stopped? Walls stop it, and so does the exit line of its maze, so
	//every enemy stays in the maze of its own level.
	Blocked(x, z)
	{
		return m.walls.CircleHits(x, z, ENEMY_RADIUS) || LEVELS[this.level].escaped(x, z);
	}

	//A random direction the enemy can move in without walking into a wall or out of its maze.
	FreeDirection()
	{
		for(var tries = 0; tries < 10; tries++)
		{
			var velocity = RandomVelocity();
			if(!this.Blocked(this.loc[0] + velocity[0], this.loc[2] + velocity[2]))
				return velocity;
		}
		return [-this.velocity[0], 0, -this.velocity[2]];
	}

	//Koopas throw a shell at the player at most every 50 steps, when the player is in their
	//maze, in sight and close by.
	ThrowShell()
	{
		var player = m.player;
		if(m.state != "playing" || this.level != m.currentLevel)
			return;
		if(this.shellWait < 50)
			this.shellWait += 1;
		var d = this.Distance(player);
		if(this.shellWait < 50 || d > KOOPA_RANGE || !m.walls.LineOfSight(this.loc, player.loc))
			return;
		this.shellWait = 0;
		var shell = m.CreateObject(3, Quad, [this.loc[0], 0, this.loc[2]], [0,0,0], 0);
		shell.ChangeToShell();
		shell.velocity = [(player.loc[0] - this.loc[0])/d*SHOT_SPEED, 0, (player.loc[2] - this.loc[2])/d*SHOT_SPEED];
	}

	//Walking animation: frames 1, 3, 1, 2, ... switching every frameSteps steps.
	SetAnimation(frames, frameSteps)
	{
		this.frames = [frames[0], frames[2], frames[0], frames[1]];
		this.frameSteps = frameSteps;
		this.frame = 0;
		this.frameTime = 0;
		this.MyTexture = this.frames[0];
	}
	Animate()
	{
		if(this.frames && ++this.frameTime >= this.frameSteps)
		{
			this.frameTime = 0;
			this.frame = (this.frame + 1) % this.frames.length;
			this.MyTexture = this.frames[this.frame];
		}
	}

	ChangeToGoomba(hp)
	{
		this.cat = 0;
		this.hp = hp;
		this.velocity = [0,0,.05];
		this.SetAnimation([TEX.goomba1, TEX.goomba2, TEX.goomba3], 10);
	}
	ChangeToKoopa(hp)
	{
		this.cat = 1;
		this.hp = hp;
		this.velocity = RandomVelocity();
		this.shellWait = Math.floor(Math.random()*50);    //so the Koopas do not all throw at once
		this.SetAnimation([TEX.koopa1, TEX.koopa2, TEX.koopa3], 30);
	}
	ChangeToBobomb(hp)
	{
		this.cat = 2;
		this.hp = hp;
		this.velocity = RandomVelocity();
		//A Bob-omb stands still in its second image, so it cycles 2, 3, 2, 1 as in the 2020 version.
		this.SetAnimation([TEX.bobomb2, TEX.bobomb1, TEX.bobomb3], 20);
	}
	//1 = fireball, 2 = splatter, 3 = banana. They only look different.
	ChangeToProjectile(kind)
	{
		this.cat = 3;
		this.scale = .5;
		this.MyTexture = [TEX.fireball, TEX.splatter, TEX.banana][kind - 1];
	}
	ChangeToShell()
	{
		this.cat = 4;
		this.scale = .5;
		this.MyTexture = TEX.shell;
	}
	ChangeToExplosion()
	{
		this.cat = 5;
		this.frames = null;
		this.MyTexture = TEX.explosion;
	}
}

function RandomVelocity()
{
	return [(Math.random()*2-1)/50, 0, (Math.random()*2-1)/50];
}

//A 2 x 2 x 2 wall cube. All blocks are drawn together by Walls.
class Block extends GameObject
{
	constructor()
	{
		super();
		this.name = "Block";
		this.texture = TEX.brick;
	}
	ChangeToRock()
	{
		this.texture = TEX.rock;
	}
	Update()
	{
		//walls never move
	}
	Render(webgl)
	{
		//drawn in one batch per texture by Walls.Render
	}
}

//The cube as the 2020 version drew it: a 14-vertex triangle strip (X, Y, Z, S, T), here
//unrolled into 12 separate triangles so that many cubes can share one vertex buffer.
Block.strip = [
	[-1, -1, -1, 0, 1], //back bottom left
	[ 1, -1, -1, 1, 1], //back bottom right
	[-1,  1, -1, 0, 0], //back top left
	[ 1,  1, -1, 1, 0], //back top right
	[ 1,  1,  1, 1, 1], //front top right
	[ 1, -1, -1, 0, 0], //back bottom right
	[ 1, -1,  1, 0, 1], //front bottom right
	[-1, -1, -1, 1, 0], //back bottom left
	[-1, -1,  1, 1, 1], //front bottom left
	[-1,  1, -1, 0, 0], //back top left
	[-1,  1,  1, 0, 1], //front top left
	[ 1,  1,  1, 1, 1], //front top right
	[-1, -1,  1, 0, 0], //front bottom left
	[ 1, -1,  1, 1, 0]  //front bottom right
];
Block.triangles = Block.strip.slice(2).flatMap((v, i) => [Block.strip[i], Block.strip[i + 1], v]);

//All wall blocks. A grid of 2 x 2 cells answers collision tests by looking only at the
//blocks next to a position, and the blocks are drawn with one draw call per texture.
class Walls
{
	constructor()
	{
		this.origin = -80;     //world x and z of the centre of grid cell 0
		this.cells = 80;
		this.grid = new Uint8Array(this.cells*this.cells);
		this.blocks = [];
		this.batches = [];
	}
	Add(block)
	{
		var i = (block.loc[0] - this.origin)/2;
		var j = (block.loc[2] - this.origin)/2;
		this.grid[j*this.cells + i] = 1;
		this.blocks.push(block);
	}
	IsWall(i, j)
	{
		return i >= 0 && j >= 0 && i < this.cells && j < this.cells && this.grid[j*this.cells + i] == 1;
	}

	//Does a circle of radius r at world (x, z) overlap a wall cube?
	CircleHits(x, z, r)
	{
		var i0 = Math.ceil((x - r - 1 - this.origin)/2), i1 = Math.floor((x + r + 1 - this.origin)/2);
		var j0 = Math.ceil((z - r - 1 - this.origin)/2), j1 = Math.floor((z + r + 1 - this.origin)/2);
		for(var j = j0; j <= j1; j++)
		{
			for(var i = i0; i <= i1; i++)
			{
				if(!this.IsWall(i, j))
					continue;
				//distance from the circle's centre to the nearest point of the cube
				var dx = Math.max(Math.abs(x - (this.origin + 2*i)) - 1, 0);
				var dz = Math.max(Math.abs(z - (this.origin + 2*j)) - 1, 0);
				if(dx*dx + dz*dz < r*r)
					return true;
			}
		}
		return false;
	}

	//Could a shell fly in a straight line from a to b without touching a wall?
	LineOfSight(a, b)
	{
		var dx = b[0] - a[0];
		var dz = b[2] - a[2];
		var steps = Math.ceil(Math.sqrt(dx*dx + dz*dz)/.25);
		for(var k = 1; k < steps; k++)
		{
			if(this.CircleHits(a[0] + dx*k/steps, a[2] + dz*k/steps, SHOT_RADIUS))
				return false;
		}
		return true;
	}

	//Builds one vertex buffer per texture: X, Y, Z, S, T, then the block's position.
	Build()
	{
		var byTexture = new Map();
		for(var block of this.blocks)
		{
			if(!byTexture.has(block.texture))
				byTexture.set(block.texture, []);
			byTexture.get(block.texture).push(block);
		}
		for(var [texture, blocks] of byTexture)
		{
			var data = new Float32Array(blocks.length*Block.triangles.length*8);
			var k = 0;
			for(var b of blocks)
			{
				for(var v of Block.triangles)
				{
					data.set(v, k);
					data.set(b.loc, k + 5);
					k += 8;
				}
			}
			var buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			this.batches.push({ texture: texture, buffer: buffer, count: blocks.length*Block.triangles.length });
		}
	}
	Render(webgl)
	{
		var stride = 8*Float32Array.BYTES_PER_ELEMENT;
		gl.uniform3f(webgl.uniform.transform, 0, 0, 0);
		gl.uniform3f(webgl.uniform.rotation, 0, 0, 0);
		gl.enableVertexAttribArray(webgl.attrib.a_offset);
		for(var batch of this.batches)
		{
			gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
			gl.vertexAttribPointer(webgl.attrib.a_position, 3, gl.FLOAT, false, stride, 0);
			gl.vertexAttribPointer(webgl.attrib.texcord, 2, gl.FLOAT, false, stride, 3*Float32Array.BYTES_PER_ELEMENT);
			gl.vertexAttribPointer(webgl.attrib.a_offset, 3, gl.FLOAT, false, stride, 5*Float32Array.BYTES_PER_ELEMENT);
			gl.bindTexture(gl.TEXTURE_2D, batch.texture);
			gl.drawArrays(gl.TRIANGLES, 0, batch.count);
		}
		//Everything else is drawn with the offset at its default, (0, 0, 0).
		gl.disableVertexAttribArray(webgl.attrib.a_offset);
	}
}

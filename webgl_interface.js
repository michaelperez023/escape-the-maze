// Compiles and links the shaders in index.html and keeps the locations of their inputs.
// Based on the course's WebGL texture example (SimpleTextureExample).
class WebGL_Interface
{
	constructor()
	{
		this.vertexShaderSource = document.getElementById("2dVertexShader").text;
		this.fragmentShaderSource = document.getElementById("2dFragmentShader").text;
		this.vertexShader = this.createShader(gl.VERTEX_SHADER, this.vertexShaderSource);
		this.fragmentShader = this.createShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource);
		//Link to program
		this.program = this.createProgram(this.vertexShader, this.fragmentShader);
		gl.useProgram(this.program);

		//Look every attribute and uniform up once instead of on every draw call.
		this.attrib = {};
		for (const name of ["a_position", "texcord", "a_offset"])
			this.attrib[name] = gl.getAttribLocation(this.program, name);
		this.uniform = {};
		for (const name of ["transform", "rotation", "scale", "worldLoc", "worldRotation", "n", "f", "r", "t", "FaceCam", "sampler", "lights"])
			this.uniform[name] = gl.getUniformLocation(this.program, name);
		//Every draw call reads positions and texture coordinates from a buffer. a_offset is only
		//read from a buffer for the walls; everything else uses its constant value, (0, 0, 0).
		gl.enableVertexAttribArray(this.attrib.a_position);
		gl.enableVertexAttribArray(this.attrib.texcord);
		gl.vertexAttrib3f(this.attrib.a_offset, 0, 0, 0);

		//set clear colors
		gl.clearColor(.5, .5, 1, 1);
		gl.enable(gl.DEPTH_TEST);

		gl.uniform3fv(this.uniform.worldLoc, new Float32Array([0, 0, 0]));
		gl.uniform3fv(this.uniform.worldRotation, new Float32Array([0, 0, 0]));
		gl.uniform1f(this.uniform.scale, 1);
		gl.uniform1i(this.uniform.FaceCam, 0);
		gl.uniform1i(this.uniform.sampler, 0);
		//Near and far planes. t is the half-height of the view at the near plane.
		gl.uniform1f(this.uniform.n, .1);
		gl.uniform1f(this.uniform.f, 500);
		gl.uniform1f(this.uniform.t, .06);
		this.Resize(gl.canvas.width, gl.canvas.height);
	}

	//Match the viewport and the projection to the canvas, so the picture is not stretched.
	Resize(width, height)
	{
		gl.viewport(0, 0, width, height);
		gl.uniform1f(this.uniform.r, .06 * width / Math.max(height, 1));
	}

	createShader(type, source)
	{
		var shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (gl.getShaderParameter(shader, gl.COMPILE_STATUS))
		{
			return shader;
		}
		//Else it didn't work
		var log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error("Shader did not compile: " + log);
	}

	createProgram(vs, fs)
	{
		var program = gl.createProgram();
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		//Attribute 0 must always be an enabled array, so give it to the vertex position.
		gl.bindAttribLocation(program, 0, "a_position");
		gl.linkProgram(program);
		if (gl.getProgramParameter(program, gl.LINK_STATUS))
		{
			return program;
		}
		var log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error("Shader program did not link: " + log);
	}
}

// Sound effects, synthesized with the Web Audio API each time they play. There are no audio files.

//A short burst of filtered noise.
function NoiseBurst(context, destination, noise, start, duration, filterType, frequency, peak)
{
	const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
	source.buffer = noise;
	filter.type = filterType;
	filter.frequency.value = frequency;
	gain.gain.setValueAtTime(.0001, start);
	gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(.004, duration / 4));
	gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
	source.connect(filter);
	filter.connect(gain);
	gain.connect(destination);
	source.start(start, Math.random() * (noise.duration - duration));
	source.stop(start + duration);
}

//A projectile hitting an enemy: a soft whoosh with a dozen sharp crackles on top.
function PlayFireCrackle(context, destination, noise, start, volume)
{
	NoiseBurst(context, destination, noise, start, .35, "bandpass", 1200, .5 * volume);
	for (let i = 0; i < 12; i++)
		NoiseBurst(context, destination, noise, start + Math.random() * .3, .01 + Math.random() * .02,
			"highpass", 2500 + Math.random() * 3500, (.2 + Math.random() * .4) * volume);
}

//A Koopa shell hitting a wall or the player: a falling metallic ping after a click.
function PlayShellRicochet(context, destination, noise, start, volume)
{
	const gain = context.createGain();
	gain.gain.setValueAtTime(.0001, start);
	gain.gain.exponentialRampToValueAtTime(.25 * volume, start + .005);
	gain.gain.exponentialRampToValueAtTime(.0001, start + .35);
	gain.connect(destination);
	for (const [type, ratio, level] of [["triangle", 1, 1], ["sine", 2.76, .4]])
	{
		const oscillator = context.createOscillator(), partial = context.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(2400 * ratio, start);
		oscillator.frequency.exponentialRampToValueAtTime(800 * ratio, start + .3);
		partial.gain.value = level;
		oscillator.connect(partial);
		partial.connect(gain);
		oscillator.start(start);
		oscillator.stop(start + .36);
	}
	NoiseBurst(context, destination, noise, start, .03, "highpass", 3000, .3 * volume);
}

//Makes one second of white noise that every sound reuses.
function MakeNoise(context)
{
	const noise = context.createBuffer(1, context.sampleRate, context.sampleRate), samples = noise.getChannelData(0);
	for (let i = 0; i < samples.length; i++)
		samples[i] = Math.random() * 2 - 1;
	return noise;
}

class SoundEffects
{
	constructor()
	{
		this.enabled = true;
		this.context = null;
		this.lastPlayed = {};
	}

	//Browsers only let a page start audio after the player clicks or presses a key, so the
	//level buttons call this.
	Unlock()
	{
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass)
			return;
		if (!this.context)
		{
			this.context = new AudioContextClass();
			this.output = this.context.createGain();
			this.output.gain.value = .7;
			this.output.connect(this.context.destination);
			this.noise = MakeNoise(this.context);
		}
		if (this.context.state === "suspended")
			this.context.resume();
	}

	//Plays a sound at the given volume (0 to 1), at most once every 60 ms for each sound.
	Play(sound, volume)
	{
		if (!this.enabled || !this.context || this.context.state !== "running" || volume <= 0)
			return;
		const now = this.context.currentTime;
		if (now - (this.lastPlayed[sound.name] ?? -1) < .06)
			return;
		this.lastPlayed[sound.name] = now;
		sound(this.context, this.output, this.noise, now, Math.min(volume, 1));
	}
}

var sounds = new SoundEffects();

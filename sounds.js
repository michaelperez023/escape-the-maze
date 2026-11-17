// Sound: the background music, assets/song.mp3, and the sound effects, which are synthesized
// with the Web Audio API each time they play. The music is downloaded when a level first
// starts with sound on, so no audio file is loaded before then.

//The music loops without a gap. Chrome's decoder already drops the encoder delay and padding
//that the file's iTunSMPB tag records (at 44.1 kHz it decodes exactly the 3,612,020 samples the
//tag gives), but the song itself starts with about 20 ms of silence and ends with more than a
//second of it, so the loop runs from just before its first note to just after its last note
//has faded out.
var MUSIC = {
	file: "assets/song.mp3",
	volume: .12,        //the music's typical loudness is then about 7 dB under a sound effect at full volume
	loopStart: .019,    //seconds
	loopEnd: 80.755,
	fade: .015          //time constant of the fade when the music starts or pauses, in seconds
};

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
		this.musicWanted = false;            //a level is on, so the music should play
		this.musicRequested = false;         //the song is only requested once, even if loading fails
		this.musicBuffer = null;             //the decoded song
		this.musicSource = null;             //the AudioBufferSourceNode playing it, while it plays
		this.musicGain = null;               //its own gain node, which fades it in and out
		this.musicOffset = MUSIC.loopStart;  //where in the song it starts or resumes, in seconds
		this.musicStarted = 0;               //the context time when musicSource started
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

	//Starting a level calls this; going back to the title menu calls PauseMusic, and the
	//music resumes from the same place.
	PlayMusic()
	{
		this.musicWanted = true;
		this.UpdateMusic();
	}
	PauseMusic()
	{
		this.musicWanted = false;
		this.UpdateMusic();
	}

	//Plays the music while a level is on, sound is on and the tab is visible, and pauses it
	//otherwise. While the song is still loading, only musicWanted changes; it is checked again
	//once the song has loaded, so there is never more than one copy playing.
	UpdateMusic()
	{
		if (!this.context)
			return;
		if (this.musicWanted && this.enabled && !this.musicRequested)
			this.LoadMusic();
		const play = this.musicWanted && this.enabled && !document.hidden && this.musicBuffer !== null;
		const now = this.context.currentTime;
		if (play && !this.musicSource)
		{
			this.musicSource = this.context.createBufferSource();
			this.musicSource.buffer = this.musicBuffer;
			this.musicSource.loop = true;
			this.musicSource.loopStart = MUSIC.loopStart;
			this.musicSource.loopEnd = MUSIC.loopEnd;
			this.musicGain = this.context.createGain();
			this.musicGain.gain.setValueAtTime(0, now);
			this.musicGain.gain.setTargetAtTime(MUSIC.volume, now, MUSIC.fade);
			this.musicSource.connect(this.musicGain);
			this.musicGain.connect(this.output);
			this.musicSource.start(now, this.musicOffset);
			this.musicStarted = now;
		}
		else if (!play && this.musicSource)
		{
			this.musicOffset = this.musicPosition;
			this.musicGain.gain.setTargetAtTime(0, now, MUSIC.fade);
			this.musicSource.stop(now + 10 * MUSIC.fade);
			this.musicSource = null;
		}
	}

	//Downloads and decodes the song. If that fails, for example offline, the game goes on
	//without music.
	LoadMusic()
	{
		this.musicRequested = true;
		fetch(MUSIC.file)
			.then(response =>
			{
				if (!response.ok)
					throw new Error("HTTP status " + response.status);
				return response.arrayBuffer();
			})
			.then(data => this.context.decodeAudioData(data))
			.then(buffer =>
			{
				this.musicBuffer = buffer;
				this.UpdateMusic();
			})
			.catch(error => console.warn("The game will play without music: " + MUSIC.file + " could not be loaded (" + error.message + ")."));
	}

	//Whether the music is playing, and where it is in the song (or where it paused), in
	//seconds. The smoke test reads these.
	get musicPlaying()
	{
		return this.musicSource !== null;
	}
	get musicPosition()
	{
		if (!this.musicSource)
			return this.musicOffset;
		const position = this.musicOffset + this.context.currentTime - this.musicStarted;
		return position < MUSIC.loopEnd ? position
			: MUSIC.loopStart + (position - MUSIC.loopStart) % (MUSIC.loopEnd - MUSIC.loopStart);
	}
}

var sounds = new SoundEffects();

class MabelVadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "inactive";
    this.noiseFloor = 0.006;
    this.noiseSamples = 0;
    this.modeSamples = 0;
    this.aboveSamples = 0;
    this.silenceSamples = 0;
    this.captureChunks = [];
    this.captureLength = 0;
    this.capturing = false;
    this.levelSamples = 0;
    this.preRollSize = Math.round(sampleRate * 0.4);
    this.preRoll = new Float32Array(this.preRollSize);
    this.preRollWrite = 0;
    this.preRollFilled = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "mode") {
        this.mode = data.mode;
        this.modeSamples = 0;
        this.aboveSamples = 0;
        this.silenceSamples = 0;
        if (data.resetCapture) this.clearCapture();
      }
      if (data?.type === "cancel-capture") this.clearCapture();
    };
  }

  clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  updateNoiseFloor(rms) {
    const weight = this.noiseSamples < sampleRate ? 0.08 : 0.012;
    if (this.noiseSamples < sampleRate || rms < this.noiseFloor * 2.2) {
      this.noiseFloor = this.clamp((this.noiseFloor * (1 - weight)) + (rms * weight), 0.002, 0.04);
      this.noiseSamples += 128;
    }
  }

  writePreRoll(input) {
    for (let index = 0; index < input.length; index += 1) {
      this.preRoll[this.preRollWrite] = input[index];
      this.preRollWrite = (this.preRollWrite + 1) % this.preRollSize;
      this.preRollFilled = Math.min(this.preRollSize, this.preRollFilled + 1);
    }
  }

  beginCapture() {
    const buffered = new Float32Array(this.preRollFilled);
    const start = (this.preRollWrite - this.preRollFilled + this.preRollSize) % this.preRollSize;
    for (let index = 0; index < this.preRollFilled; index += 1) {
      buffered[index] = this.preRoll[(start + index) % this.preRollSize];
    }
    this.captureChunks = buffered.length ? [buffered] : [];
    this.captureLength = buffered.length;
    this.capturing = true;
    this.silenceSamples = 0;
  }

  appendCapture(input) {
    const copy = new Float32Array(input);
    this.captureChunks.push(copy);
    this.captureLength += copy.length;
  }

  clearCapture() {
    this.captureChunks = [];
    this.captureLength = 0;
    this.capturing = false;
    this.silenceSamples = 0;
  }

  finishCapture() {
    if (!this.capturing || this.captureLength < sampleRate * 0.18) {
      this.clearCapture();
      return;
    }
    const pcm = new Float32Array(this.captureLength);
    let offset = 0;
    for (const chunk of this.captureChunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    this.clearCapture();
    this.mode = "inactive";
    this.port.postMessage({ type: "utterance", pcm: pcm.buffer, sampleRate }, [pcm.buffer]);
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    for (const output of outputs[0] || []) output.fill(0);
    if (!input?.length) return true;

    let energy = 0;
    for (const sample of input) energy += sample * sample;
    const rms = Math.sqrt(energy / input.length);
    this.modeSamples += input.length;
    this.levelSamples += input.length;

    const startThreshold = this.clamp(this.noiseFloor * 3.1, 0.012, 0.065);
    const endThreshold = this.clamp(this.noiseFloor * 1.7, 0.008, 0.035);
    const bargeThreshold = this.clamp(this.noiseFloor * 4.2, 0.038, 0.11);

    if (this.levelSamples >= sampleRate / 20) {
      this.levelSamples = 0;
      this.port.postMessage({ type: "level", rms, noiseFloor: this.noiseFloor, startThreshold });
    }

    if (this.mode === "inactive") {
      this.updateNoiseFloor(rms);
      this.writePreRoll(input);
      return true;
    }

    if (this.mode === "speaking" && !this.capturing) {
      if (rms < this.noiseFloor * 2.2) this.updateNoiseFloor(rms);
      if (this.modeSamples > sampleRate * 0.25 && rms > bargeThreshold) this.aboveSamples += input.length;
      else this.aboveSamples = Math.max(0, this.aboveSamples - input.length);
      if (this.aboveSamples >= sampleRate * 0.11) {
        this.beginCapture();
        this.appendCapture(input);
        this.mode = "listening";
        this.modeSamples = 0;
        this.aboveSamples = 0;
        this.port.postMessage({ type: "bargein" });
      }
      this.writePreRoll(input);
      return true;
    }

    if (this.mode === "listening") {
      if (!this.capturing) {
        this.updateNoiseFloor(rms);
        if (rms > startThreshold) this.aboveSamples += input.length;
        else this.aboveSamples = Math.max(0, this.aboveSamples - input.length);
        if (this.aboveSamples >= sampleRate * 0.055) {
          this.beginCapture();
          this.appendCapture(input);
          this.aboveSamples = 0;
          this.port.postMessage({ type: "speechstart" });
        }
      } else {
        this.appendCapture(input);
        if (rms < endThreshold) this.silenceSamples += input.length;
        else this.silenceSamples = 0;
        const spokenSamples = this.captureLength - this.preRollFilled;
        if ((spokenSamples > sampleRate * 0.45 && this.silenceSamples >= sampleRate * 1.0) || spokenSamples >= sampleRate * 20) {
          this.finishCapture();
        }
      }
      this.writePreRoll(input);
    }
    return true;
  }
}

registerProcessor("mabel-vad", MabelVadProcessor);

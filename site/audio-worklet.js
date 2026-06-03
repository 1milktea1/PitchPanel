class PitchPanelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.carry = new Float32Array(0);
    this.targetSampleRate = 24000;
    this.frameSize = 1200;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    const resampled = this.resample(input, sampleRate, this.targetSampleRate);
    const merged = new Float32Array(this.carry.length + resampled.length);
    merged.set(this.carry);
    merged.set(resampled, this.carry.length);

    let offset = 0;
    while (offset + this.frameSize <= merged.length) {
      const frame = merged.slice(offset, offset + this.frameSize);
      const pcm = this.floatToPcm16(frame);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      offset += this.frameSize;
    }

    this.carry = merged.slice(offset);
    return true;
  }

  resample(input, fromRate, toRate) {
    if (fromRate === toRate) return input.slice();
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = i * ratio;
      const before = Math.floor(sourceIndex);
      const after = Math.min(before + 1, input.length - 1);
      const weight = sourceIndex - before;
      output[i] = input[before] * (1 - weight) + input[after] * weight;
    }

    return output;
  }

  floatToPcm16(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }
}

registerProcessor("pitchpanel-processor", PitchPanelProcessor);

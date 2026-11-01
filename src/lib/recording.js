// Convert browser recordings to 16 kHz mono WAV, which audio models accept widely.
export async function recordingToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineContextClass =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineContextClass)
    throw new Error("Audio processing is unavailable in this browser.");
  const context = new AudioContextClass();
  let decoded;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
  if (!decoded.duration || decoded.duration > 32)
    throw new Error("Please record a message of up to 30 seconds.");
  const sampleRate = 16000;
  const offline = new OfflineContextClass(
    1,
    Math.ceil(decoded.duration * sampleRate),
    sampleRate,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) =>
    [...text].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  write(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      value < 0 ? value * 32768 : value * 32767,
      true,
    );
  });
  return new Blob([buffer], { type: "audio/wav" });
}

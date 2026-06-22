import { AudioChunk, ChunkStrategy } from '../types';

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatTimestamp(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00:00.000';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    const timeout = setTimeout(() => { cleanup(); resolve(0); }, 10000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      cleanup();
      resolve(isFinite(audio.duration) ? audio.duration : 0);
    });
    audio.addEventListener('error', () => {
      clearTimeout(timeout);
      cleanup();
      resolve(0);
    });
    audio.preload = 'metadata';
    audio.src = url;
  });
}

export async function generateWaveform(file: File, samples: number = 60): Promise<number[]> {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const sliceSize = Math.min(file.size, 4 * 1024 * 1024);
    const arrayBuffer = await file.slice(0, sliceSize).arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const waveform: number[] = [];
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      const end = Math.min((i + 1) * blockSize, channelData.length);
      for (let j = i * blockSize; j < end; j++) {
        sum += Math.abs(channelData[j] || 0);
      }
      waveform.push(sum / blockSize);
    }
    const max = Math.max(...waveform, 0.001);
    ctx.close();
    return waveform.map(v => v / max);
  } catch {
    return Array.from({ length: samples }, () => Math.random() * 0.5 + 0.1);
  }
}

// ─── Smart Auto-Chunking ──────────────────────────────────
export function computeChunkStrategy(file: File, duration: number): ChunkStrategy {
  const fileSizeMB = file.size / (1024 * 1024);
  const safeDuration = Math.max(duration, 0.1);
  const durationMin = safeDuration / 60;
  const maxAPIFileSizeMB = 24;
  const bitrateKBps = (file.size / 1024) / safeDuration;

  let chunkDurationSec: number;
  let reason: string;

  if (fileSizeMB <= maxAPIFileSizeMB && durationMin <= 15) {
    chunkDurationSec = safeDuration;
    reason = 'File within API limits — processing as single unit';
  } else if (fileSizeMB > maxAPIFileSizeMB) {
    const maxDurationForSize = (maxAPIFileSizeMB * 1024) / Math.max(bitrateKBps, 0.1);
    chunkDurationSec = Math.min(maxDurationForSize, 10 * 60);
    reason = `File exceeds 25MB limit (${fileSizeMB.toFixed(1)}MB) — splitting by size constraint`;
  } else if (durationMin <= 30) {
    chunkDurationSec = 10 * 60;
    reason = 'Medium file — 10-minute segments for accuracy';
  } else if (durationMin <= 90) {
    chunkDurationSec = 8 * 60;
    reason = 'Long file — 8-minute segments for reliability';
  } else {
    chunkDurationSec = 6 * 60;
    reason = 'Extended recording — 6-minute segments for stability';
  }

  // Ensure minimum chunk duration of 5 seconds
  chunkDurationSec = Math.max(chunkDurationSec, 5);

  const overlapSec = chunkDurationSec >= safeDuration ? 0 : 3;
  const effectiveChunkDuration = Math.max(chunkDurationSec - overlapSec, 1);
  const totalChunks = effectiveChunkDuration >= safeDuration ? 1 : Math.ceil(safeDuration / effectiveChunkDuration);

  return {
    totalChunks,
    chunkDurationSec,
    reason,
    fileSizeMB,
    estimatedDurationMin: durationMin,
    overlapSec,
  };
}

export async function createAudioChunks(
  file: File,
  strategy: ChunkStrategy,
  duration: number,
): Promise<AudioChunk[]> {
  if (strategy.totalChunks <= 1) {
    return [{
      id: generateId(),
      index: 0,
      startTime: 0,
      endTime: duration,
      status: 'pending',
      blob: file,
      retryCount: 0,
    }];
  }

  // For files > 500MB, use byte-level splitting to avoid memory issues
  if (file.size > 500 * 1024 * 1024) {
    return createByteChunks(file, strategy, duration);
  }

  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const effectiveDuration = strategy.chunkDurationSec - strategy.overlapSec;
    const chunks: AudioChunk[] = [];

    for (let i = 0; i < strategy.totalChunks; i++) {
      const startTime = i * effectiveDuration;
      const endTime = Math.min(startTime + strategy.chunkDurationSec, duration);
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
      const chunkLength = endSample - startSample;

      if (chunkLength <= 0) continue;

      const chunkBuffer = ctx.createBuffer(numChannels, chunkLength, sampleRate);
      for (let ch = 0; ch < numChannels; ch++) {
        const sourceData = audioBuffer.getChannelData(ch);
        const chunkData = chunkBuffer.getChannelData(ch);
        for (let s = 0; s < chunkLength; s++) {
          chunkData[s] = sourceData[startSample + s] || 0;
        }
      }

      const wavBlob = audioBufferToWav(chunkBuffer);
      chunks.push({
        id: generateId(),
        index: i,
        startTime,
        endTime,
        status: 'pending',
        blob: wavBlob,
        retryCount: 0,
      });
    }

    ctx.close();
    return chunks;
  } catch {
    return createByteChunks(file, strategy, duration);
  }
}

function createByteChunks(file: File, strategy: ChunkStrategy, duration: number): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  const safeDuration = Math.max(duration, 0.1);
  const bytesPerSecond = file.size / safeDuration;
  const effectiveDuration = strategy.chunkDurationSec - strategy.overlapSec;

  for (let i = 0; i < strategy.totalChunks; i++) {
    const startTime = i * effectiveDuration;
    const endTime = Math.min(startTime + strategy.chunkDurationSec, duration);
    const startByte = Math.floor(startTime * bytesPerSecond);
    const endByte = Math.min(Math.floor(endTime * bytesPerSecond), file.size);

    if (endByte <= startByte) continue;

    chunks.push({
      id: generateId(),
      index: i,
      startTime,
      endTime,
      status: 'pending',
      blob: file.slice(startByte, endByte, file.type || 'audio/mpeg'),
      retryCount: 0,
    });
  }

  return chunks;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export const SPEAKER_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

export function getSpeakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

export const SUPPORTED_EXTENSIONS = [
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.webm', '.mp4',
  '.wma', '.amr', '.3gp', '.opus', '.caf', '.aiff',
];

export const SUPPORTED_MIMES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/m4a',
  'audio/x-m4a', 'audio/aac', 'audio/webm', 'video/mp4', 'video/webm',
  'video/ogg', 'audio/amr', 'audio/3gpp', 'audio/opus', 'audio/aiff',
];

export function isSupported(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  return SUPPORTED_MIMES.includes(file.type) || SUPPORTED_EXTENSIONS.includes(ext);
}

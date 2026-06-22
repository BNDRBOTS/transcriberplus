export interface AudioFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  duration: number | null;
  status: 'queued' | 'analyzing' | 'chunking' | 'transcribing' | 'enhancing' | 'complete' | 'error';
  progress: number;
  transcription: TranscriptionResult | null;
  error: string | null;
  chunks: AudioChunk[];
  waveform: number[];
  chunkStrategy: ChunkStrategy | null;
}

export interface ChunkStrategy {
  totalChunks: number;
  chunkDurationSec: number;
  reason: string;
  fileSizeMB: number;
  estimatedDurationMin: number;
  overlapSec: number;
}

export interface AudioChunk {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  blob: Blob | null;
  retryCount: number;
}

export interface TranscriptionSegment {
  id: string;
  speaker: string;
  speakerColor: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  fullText: string;
  speakers: SpeakerInfo[];
  duration: number;
  language: string;
  wordCount: number;
  modelUsed: string;
  processingTime: number;
}

export interface SpeakerInfo {
  id: string;
  label: string;
  color: string;
  totalDuration: number;
  segmentCount: number;
  percentage: number;
}

export interface AppSettings {
  apiKeys: Record<string, string>;
  transcriptionModel: string;
  enhancementModel: string;
  language: string;
  enableSpeakerDiarization: boolean;
  maxSpeakers: number;
  enableEnhancement: boolean;
  outputFormat: 'txt' | 'md' | 'srt' | 'json';
  autoChunk: boolean;
  maxRetries: number;
}

export type ViewMode = 'upload' | 'processing' | 'results';

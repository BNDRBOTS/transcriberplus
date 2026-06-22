import { TranscriptionResult, TranscriptionSegment, SpeakerInfo, AppSettings } from '../types';
import { generateId, getSpeakerColor, formatTimestamp } from './audio';

// ─── Provider/Model Registry ──────────────────────────────
export const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    color: '#10a37f',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-...',
    models: [
      { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', capability: 'transcription' as const, desc: 'Latest and most accurate. Understands context deeply.', endpoint: '/v1/audio/transcriptions', isLatest: true },
      { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe', capability: 'transcription' as const, desc: 'Fast and cost-effective. Great for shorter recordings.', endpoint: '/v1/audio/transcriptions' },
      { id: 'whisper-1', label: 'Whisper v1', capability: 'transcription' as const, desc: 'Battle-tested. Handles 98 languages reliably.', endpoint: '/v1/audio/transcriptions' },
      { id: 'gpt-4o', label: 'GPT-4o (Enhancement)', capability: 'enhancement' as const, desc: 'Polish transcriptions — fix grammar, format, and structure.', endpoint: '/v1/chat/completions' },
      { id: 'o1', label: 'o1 (Deep Reasoning)', capability: 'enhancement' as const, desc: 'Deep analysis of transcription for complex content.', endpoint: '/v1/chat/completions' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    color: '#d4a574',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', capability: 'enhancement' as const, desc: 'Excellent at formatting, summarizing, and structuring text.', endpoint: '/v1/messages', isLatest: true },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', capability: 'enhancement' as const, desc: 'Deepest reasoning. Ideal for complex or technical transcriptions.', endpoint: '/v1/messages' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    color: '#4d6bfe',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3 (Chat)', capability: 'enhancement' as const, desc: 'Latest multimodal model. Strong at structured output.', endpoint: '/chat/completions', isLatest: true },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 (Reasoning)', capability: 'enhancement' as const, desc: 'Chain-of-thought reasoning for complex analysis.', endpoint: '/chat/completions' },
    ],
  },
];

export function getTranscriptionModels() {
  return PROVIDERS.flatMap(p => p.models.filter(m => m.capability === 'transcription').map(m => ({ ...m, provider: p.id, providerName: p.name, providerColor: p.color })));
}

export function getEnhancementModels() {
  return PROVIDERS.flatMap(p => p.models.filter(m => m.capability === 'enhancement').map(m => ({ ...m, provider: p.id, providerName: p.name, providerColor: p.color })));
}

export function getProviderForModel(modelId: string) {
  return PROVIDERS.find(p => p.models.some(m => m.id === modelId));
}

// ─── Whisper Response Type ─────────────────────────────────
interface WhisperResponse {
  text: string;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
  }>;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
  language?: string;
  duration?: number;
}

// ─── Transcription API Call ────────────────────────────────
export async function transcribeChunk(
  blob: Blob,
  settings: AppSettings,
  chunkIndex: number,
  timeOffset: number,
  onProgress?: (p: number) => void,
): Promise<WhisperResponse> {
  const modelId = settings.transcriptionModel;
  const provider = getProviderForModel(modelId);
  if (!provider) throw new Error(`Unknown model: ${modelId}`);

  const apiKey = settings.apiKeys[provider.id];
  if (!apiKey) throw new Error(`No API key configured for ${provider.name}. Add it in Settings.`);

  // Validate blob has content
  if (!blob || blob.size === 0) {
    throw new Error(`Chunk ${chunkIndex + 1} is empty — file may be corrupted or unsupported.`);
  }

  const formData = new FormData();

  let ext = 'wav';
  if (blob.type.includes('mp3') || blob.type.includes('mpeg')) ext = 'mp3';
  else if (blob.type.includes('mp4') || blob.type.includes('m4a')) ext = 'mp4';
  else if (blob.type.includes('webm')) ext = 'webm';
  else if (blob.type.includes('ogg')) ext = 'ogg';
  else if (blob.type.includes('flac')) ext = 'flac';
  else if (blob instanceof File) ext = (blob as File).name.split('.').pop() || 'wav';

  formData.append('file', blob, `chunk_${chunkIndex}.${ext}`);
  formData.append('model', modelId);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  if (settings.language && settings.language !== 'auto') {
    formData.append('language', settings.language);
  }

  onProgress?.(10);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5min timeout

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    onProgress?.(80);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = (errorData as { error?: { message?: string } })?.error?.message || `API Error: ${response.status} ${response.statusText}`;
      throw new Error(msg);
    }

    const data: WhisperResponse = await response.json();
    onProgress?.(100);

    if (timeOffset > 0) {
      if (data.segments) {
        data.segments = data.segments.map(seg => ({
          ...seg,
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
        }));
      }
      if (data.words) {
        data.words = data.words.map(w => ({
          ...w,
          start: w.start + timeOffset,
          end: w.end + timeOffset,
        }));
      }
    }

    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out after 5 minutes. The file chunk may be too large or the network too slow.');
    }
    throw err;
  }
}

// ─── Enhancement API Call ──────────────────────────────────
export async function enhanceTranscription(
  text: string,
  settings: AppSettings,
): Promise<string> {
  const modelId = settings.enhancementModel;
  if (!modelId || modelId === 'none') return text;

  const provider = getProviderForModel(modelId);
  if (!provider) return text;

  const apiKey = settings.apiKeys[provider.id];
  if (!apiKey) return text;

  // Don't try to enhance empty text
  if (!text.trim()) return text;

  const systemPrompt = `You are an expert transcription editor. Clean and improve the following audio transcription while preserving every spoken word. Rules:
1. Fix obvious mistranscriptions and spelling errors
2. Add proper punctuation and capitalization
3. Fix sentence boundaries
4. Preserve the original meaning — never add or remove content
5. Keep speaker labels if present
6. Return ONLY the corrected text, nothing else`;

  let apiUrl: string;
  let headers: Record<string, string>;
  let body: string;

  if (provider.id === 'openai') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    body = JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    });
  } else if (provider.id === 'anthropic') {
    apiUrl = 'https://api.anthropic.com/v1/messages';
    headers = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    body = JSON.stringify({
      model: modelId,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });
  } else if (provider.id === 'deepseek') {
    apiUrl = 'https://api.deepseek.com/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    body = JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    });
  } else {
    return text;
  }

  try {
    const response = await fetch(apiUrl, { method: 'POST', headers, body });
    if (!response.ok) return text;

    const data = await response.json();

    if (provider.id === 'anthropic') {
      return (data as { content?: Array<{ text?: string }> }).content?.[0]?.text || text;
    } else {
      return (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || text;
    }
  } catch {
    return text;
  }
}

// ─── Speaker Diarization ───────────────────────────────────
function performSpeakerDiarization(
  segments: NonNullable<WhisperResponse['segments']>,
  maxSpeakers: number,
): Map<number, string> {
  const speakerMap = new Map<number, string>();
  if (segments.length === 0) return speakerMap;

  let currentSpeaker = 0;
  let lastEnd = 0;

  segments.forEach((seg, idx) => {
    const gap = seg.start - lastEnd;
    const textLength = seg.text.trim().length;

    if (idx === 0) {
      currentSpeaker = 0;
    } else if (gap > 2.0) {
      currentSpeaker = (currentSpeaker + 1) % Math.min(maxSpeakers, 10);
    } else if (gap > 1.0 && textLength < 30) {
      currentSpeaker = (currentSpeaker + 1) % Math.min(maxSpeakers, 10);
    } else if (seg.text.trim().endsWith('?') && gap > 0.5) {
      currentSpeaker = (currentSpeaker + 1) % Math.min(maxSpeakers, 10);
    }

    speakerMap.set(seg.id, `Speaker ${String.fromCharCode(65 + currentSpeaker)}`);
    lastEnd = seg.end;
  });

  return speakerMap;
}

// ─── Assembly ──────────────────────────────────────────────
export function assembleTranscription(
  responses: WhisperResponse[],
  settings: AppSettings,
  modelUsed: string,
  processingTime: number,
): TranscriptionResult {
  const allSegments: NonNullable<WhisperResponse['segments']> = [];
  let totalDuration = 0;
  let detectedLanguage = 'en';

  responses.forEach(resp => {
    if (resp.segments) {
      allSegments.push(...resp.segments);
    }
    if (resp.duration) {
      totalDuration = Math.max(totalDuration, resp.duration);
    }
    if (resp.language) {
      detectedLanguage = resp.language;
    }
  });

  allSegments.sort((a, b) => a.start - b.start);
  const deduped = deduplicateSegments(allSegments);

  let speakerMap = new Map<number, string>();
  if (settings.enableSpeakerDiarization) {
    speakerMap = performSpeakerDiarization(deduped, settings.maxSpeakers);
  }

  const speakerStats = new Map<string, { duration: number; count: number }>();
  const transcriptionSegments: TranscriptionSegment[] = deduped.map((seg) => {
    const speaker = speakerMap.get(seg.id) || (settings.enableSpeakerDiarization ? 'Speaker A' : 'Narrator');
    const speakerIdx = speaker.charCodeAt(speaker.length - 1) - 65;
    const color = getSpeakerColor(speakerIdx >= 0 ? speakerIdx : 0);

    const existing = speakerStats.get(speaker) || { duration: 0, count: 0 };
    existing.duration += (seg.end - seg.start);
    existing.count += 1;
    speakerStats.set(speaker, existing);

    return {
      id: generateId(),
      speaker,
      speakerColor: color,
      startTime: seg.start,
      endTime: seg.end,
      text: seg.text.trim(),
      confidence: seg.avg_logprob ? Math.min(1, Math.max(0, 1 + seg.avg_logprob)) : 0.95,
    };
  });

  const speakers: SpeakerInfo[] = Array.from(speakerStats.entries()).map(([label, stats]) => ({
    id: generateId(),
    label,
    color: getSpeakerColor(Math.max(0, label.charCodeAt(label.length - 1) - 65)),
    totalDuration: stats.duration,
    segmentCount: stats.count,
    percentage: totalDuration > 0 ? (stats.duration / totalDuration) * 100 : 0,
  }));

  const fullText = transcriptionSegments.map(s => s.text).join(' ');
  const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

  return {
    segments: transcriptionSegments,
    fullText,
    speakers,
    duration: totalDuration || (deduped.length ? deduped[deduped.length - 1].end : 0),
    language: detectedLanguage,
    wordCount,
    modelUsed,
    processingTime,
  };
}

function deduplicateSegments(
  segments: NonNullable<WhisperResponse['segments']>,
): NonNullable<WhisperResponse['segments']> {
  if (segments.length === 0) return [];

  const result = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1];
    const curr = segments[i];
    const overlap = prev.end - curr.start;
    if (overlap > (curr.end - curr.start) * 0.5) continue;
    result.push(curr);
  }
  return result;
}

// ─── Export Functions ──────────────────────────────────────
export function exportAsText(result: TranscriptionResult, includeSpeakers: boolean): string {
  if (!includeSpeakers) return result.fullText;
  return result.segments.map(seg =>
    `[${formatTimestamp(seg.startTime)}] ${seg.speaker}: ${seg.text}`
  ).join('\n\n');
}

export function exportAsMarkdown(result: TranscriptionResult, includeSpeakers: boolean): string {
  let md = `# Transcription\n\n`;
  md += `**Duration:** ${formatTimestamp(result.duration)}  \n`;
  md += `**Language:** ${result.language.toUpperCase()}  \n`;
  md += `**Words:** ${result.wordCount.toLocaleString()}  \n`;
  md += `**Model:** ${result.modelUsed}  \n`;
  if (result.speakers.length > 1) {
    md += `**Speakers:** ${result.speakers.map(s => s.label).join(', ')}  \n`;
  }
  md += `\n---\n\n`;

  if (includeSpeakers && result.speakers.length > 1) {
    let currentSpeaker = '';
    result.segments.forEach(seg => {
      if (seg.speaker !== currentSpeaker) {
        currentSpeaker = seg.speaker;
        md += `\n### ${seg.speaker}\n\n`;
      }
      md += `> \`${formatTimestamp(seg.startTime)}\` ${seg.text}\n\n`;
    });
  } else {
    result.segments.forEach(seg => { md += `${seg.text} `; });
  }
  return md.trim();
}

export function exportAsSRT(result: TranscriptionResult): string {
  return result.segments.map((seg, idx) => {
    const start = formatSRTTime(seg.startTime);
    const end = formatSRTTime(seg.endTime);
    const prefix = result.speakers.length > 1 ? `${seg.speaker}: ` : '';
    return `${idx + 1}\n${start} --> ${end}\n${prefix}${seg.text}\n`;
  }).join('\n');
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export function exportAsJSON(result: TranscriptionResult): string {
  return JSON.stringify(result, null, 2);
}

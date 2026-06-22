import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Upload, Settings, FileAudio, Trash2, Download,
  Copy, Check, X, Zap, Users, Clock, FileText,
  BarChart3, Volume2, Layers, AlertCircle, ArrowRight,
  RefreshCw, Shield, Brain, Globe, Hash,
  CheckCircle2, Loader2, Eye, Code, Key,
  Cpu, Sparkles, ChevronRight, Info, Search,
  StopCircle, ChevronDown,
} from 'lucide-react';
import { cn } from './utils/cn';
import {
  AudioFileItem, AppSettings, TranscriptionResult, ViewMode, AudioChunk,
} from './types';
import {
  generateId, formatFileSize, formatDuration, formatTimestamp,
  getAudioDuration, generateWaveform, computeChunkStrategy,
  createAudioChunks, isSupported, SUPPORTED_EXTENSIONS,
} from './utils/audio';
import {
  transcribeChunk, assembleTranscription, enhanceTranscription,
  exportAsText, exportAsMarkdown, exportAsSRT, exportAsJSON,
  PROVIDERS, getTranscriptionModels, getEnhancementModels,
} from './utils/transcription';

// ─── Default Settings ─────────────────────────────────────
const DEFAULT_SETTINGS: AppSettings = {
  apiKeys: {},
  transcriptionModel: 'gpt-4o-transcribe',
  enhancementModel: 'none',
  language: 'auto',
  enableSpeakerDiarization: true,
  maxSpeakers: 4,
  enableEnhancement: false,
  outputFormat: 'txt',
  autoChunk: true,
  maxRetries: 2,
};

function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('scribe_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

// ─── Toggle Component ────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'w-12 h-7 rounded-full transition-all relative shrink-0 touch-manipulation',
        checked ? 'bg-indigo-500' : 'bg-white/[0.1]',
      )}
    >
      <div className={cn(
        'w-5 h-5 rounded-full bg-white absolute top-1 transition-all shadow-sm',
        checked ? 'left-6' : 'left-1',
      )} />
    </button>
  );
}

// ─── Settings Panel ──────────────────────────────────────────
function SettingsPanel({
  settings, setSettings, isOpen, onClose,
}: {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [activeSection, setActiveSection] = useState<'keys' | 'models' | 'processing'>('keys');

  const sections = [
    { id: 'keys' as const, label: 'API Keys', icon: Key },
    { id: 'models' as const, label: 'Models', icon: Brain },
    { id: 'processing' as const, label: 'Processing', icon: Cpu },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg z-50 bg-[#0c0c14]/95 backdrop-blur-xl border-l border-white/[0.06] overflow-y-auto overscroll-contain"
          >
            <div className="p-5 sm:p-6 pb-[env(safe-area-inset-bottom,20px)]">
              {/* Header */}
              <div className="flex items-center justify-between mb-7">
                <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2.5">
                  <Settings className="w-5 h-5 text-indigo-400" />
                  Settings
                </h2>
                <button onClick={onClose} className="p-3 -m-1 rounded-xl hover:bg-white/[0.06] transition-colors touch-manipulation">
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              {/* Section Tabs */}
              <div className="flex gap-1 p-1 bg-white/[0.04] rounded-2xl mb-6">
                {sections.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-2 py-3 rounded-xl text-xs sm:text-sm font-medium transition-all touch-manipulation',
                      activeSection === s.id
                        ? 'bg-indigo-500/20 text-indigo-300 shadow-lg shadow-indigo-500/10'
                        : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    <s.icon className="w-4 h-4" />
                    {s.label}
                  </button>
                ))}
              </div>

              {/* API Keys Section */}
              {activeSection === 'keys' && (
                <div className="space-y-5">
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/10">
                    <Shield className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Keys stay in your browser only. They're sent directly to each provider's API — never through any third party.
                    </p>
                  </div>

                  {PROVIDERS.map(provider => (
                    <div key={provider.id} className="space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: provider.color }} />
                        {provider.name}
                        {provider.id === 'openai' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-normal">Required</span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={settings.apiKeys[provider.id] || ''}
                        onChange={e => setSettings(s => ({
                          ...s,
                          apiKeys: { ...s.apiKeys, [provider.id]: e.target.value },
                        }))}
                        placeholder={provider.keyPlaceholder}
                        autoComplete="off"
                        className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Models Section */}
              {activeSection === 'models' && (
                <div className="space-y-6">
                  <div>
                    <div className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-indigo-400" />
                      Transcription Engine
                    </div>
                    <div className="space-y-2">
                      {getTranscriptionModels().map(m => (
                        <button
                          key={m.id}
                          onClick={() => setSettings(s => ({ ...s, transcriptionModel: m.id }))}
                          className={cn(
                            'w-full text-left p-3.5 rounded-xl border transition-all touch-manipulation',
                            settings.transcriptionModel === m.id
                              ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20'
                              : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]',
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-white">{m.label}</span>
                            <div className="flex items-center gap-2">
                              {m.isLatest && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Latest</span>
                              )}
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.providerColor }} />
                            </div>
                          </div>
                          <p className="text-xs text-zinc-500">{m.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        Post-Processing
                      </div>
                      <Toggle
                        checked={settings.enableEnhancement}
                        onChange={() => setSettings(s => ({ ...s, enableEnhancement: !s.enableEnhancement }))}
                      />
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">
                      Route transcriptions through a language model to fix errors and improve formatting.
                    </p>
                    {settings.enableEnhancement && (
                      <div className="space-y-2">
                        <button
                          onClick={() => setSettings(s => ({ ...s, enhancementModel: 'none' }))}
                          className={cn(
                            'w-full text-left p-3 rounded-xl border transition-all touch-manipulation',
                            settings.enhancementModel === 'none'
                              ? 'bg-indigo-500/10 border-indigo-500/30'
                              : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]',
                          )}
                        >
                          <span className="text-sm text-zinc-400">None — raw transcription only</span>
                        </button>
                        {getEnhancementModels().map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSettings(s => ({ ...s, enhancementModel: m.id }))}
                            className={cn(
                              'w-full text-left p-3 rounded-xl border transition-all touch-manipulation',
                              settings.enhancementModel === m.id
                                ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20'
                                : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]',
                              !settings.apiKeys[m.provider] && 'opacity-50',
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-white">{m.label}</span>
                              <div className="flex items-center gap-2">
                                {m.isLatest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Latest</span>}
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.providerColor }} />
                              </div>
                            </div>
                            <p className="text-xs text-zinc-500">{m.desc}</p>
                            {!settings.apiKeys[m.provider] && (
                              <p className="text-[10px] text-amber-400 mt-1">⚠ Add {m.providerName} API key first</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Processing Section */}
              {activeSection === 'processing' && (
                <div className="space-y-6">
                  <div>
                    <div className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-indigo-400" />
                      Language
                    </div>
                    <div className="relative">
                      <select
                        value={settings.language}
                        onChange={e => setSettings(s => ({ ...s, language: e.target.value }))}
                        className="w-full px-4 py-3.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white appearance-none focus:outline-none focus:border-indigo-500/40 transition-all cursor-pointer text-sm"
                      >
                        <option value="auto">Auto-Detect</option>
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                        <option value="it">Italian</option>
                        <option value="pt">Portuguese</option>
                        <option value="nl">Dutch</option>
                        <option value="ja">Japanese</option>
                        <option value="ko">Korean</option>
                        <option value="zh">Chinese</option>
                        <option value="ar">Arabic</option>
                        <option value="hi">Hindi</option>
                        <option value="ru">Russian</option>
                        <option value="pl">Polish</option>
                        <option value="tr">Turkish</option>
                        <option value="sv">Swedish</option>
                        <option value="da">Danish</option>
                        <option value="fi">Finnish</option>
                        <option value="uk">Ukrainian</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>

                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-400" />
                        Speaker Identification
                      </div>
                      <Toggle
                        checked={settings.enableSpeakerDiarization}
                        onChange={() => setSettings(s => ({ ...s, enableSpeakerDiarization: !s.enableSpeakerDiarization }))}
                      />
                    </div>
                    {settings.enableSpeakerDiarization && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-zinc-500">Max speakers</span>
                          <span className="text-xs text-indigo-400 font-mono font-medium">{settings.maxSpeakers}</span>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={10}
                          value={settings.maxSpeakers}
                          onChange={e => setSettings(s => ({ ...s, maxSpeakers: parseInt(e.target.value) }))}
                          className="w-full accent-indigo-500"
                        />
                        <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                          <span>2</span><span>6</span><span>10</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-indigo-400" />
                        Smart Auto-Chunking
                      </div>
                      <Toggle
                        checked={settings.autoChunk}
                        onChange={() => setSettings(s => ({ ...s, autoChunk: !s.autoChunk }))}
                      />
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Analyzes file size, bitrate, and duration to split audio at optimal points. Keeps each piece under 25MB with 3-second overlaps for seamless merging.
                    </p>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-indigo-400" />
                      Auto-Retry on Failure
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      {[0, 1, 2, 3].map(n => (
                        <button
                          key={n}
                          onClick={() => setSettings(s => ({ ...s, maxRetries: n }))}
                          className={cn(
                            'flex-1 px-3 py-3 rounded-xl text-sm font-medium transition-all touch-manipulation',
                            settings.maxRetries === n
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : 'bg-white/[0.03] text-zinc-500 border border-white/[0.06] hover:border-white/[0.12]',
                          )}
                        >
                          {n === 0 ? 'Off' : `${n}×`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      Default Export Format
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {(['txt', 'md', 'srt', 'json'] as const).map(fmt => (
                        <button
                          key={fmt}
                          onClick={() => setSettings(s => ({ ...s, outputFormat: fmt }))}
                          className={cn(
                            'py-3 px-3 rounded-xl text-sm font-medium transition-all uppercase touch-manipulation',
                            settings.outputFormat === fmt
                              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                              : 'bg-white/[0.03] text-zinc-500 border border-white/[0.06] hover:border-white/[0.12]',
                          )}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Waveform ────────────────────────────────────────────────
function WaveformVis({ data, color = '#6366f1', height = 36 }: { data: number[]; color?: string; height?: number }) {
  return (
    <div className="flex items-center gap-[1px] w-full" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="rounded-full"
          style={{
            width: `${100 / data.length}%`,
            height: `${Math.max(2, v * height)}px`,
            backgroundColor: color,
            opacity: 0.3 + v * 0.7,
          }}
        />
      ))}
    </div>
  );
}

// ─── File Card ────────────────────────────────────────────────
function FileCard({
  audioFile, onRemove, isProcessing,
}: {
  audioFile: AudioFileItem;
  onRemove: (id: string) => void;
  isProcessing: boolean;
}) {
  const statusMap: Record<AudioFileItem['status'], { label: string; color: string; Icon: typeof Clock; spin?: boolean }> = {
    queued: { label: 'Ready', color: 'text-zinc-400', Icon: Clock },
    analyzing: { label: 'Analyzing', color: 'text-amber-400', Icon: Search, spin: true },
    chunking: { label: 'Splitting', color: 'text-cyan-400', Icon: Layers, spin: true },
    transcribing: { label: 'Transcribing', color: 'text-indigo-400', Icon: Brain, spin: true },
    enhancing: { label: 'Enhancing', color: 'text-violet-400', Icon: Sparkles, spin: true },
    complete: { label: 'Done', color: 'text-emerald-400', Icon: CheckCircle2 },
    error: { label: 'Failed', color: 'text-red-400', Icon: AlertCircle },
  };

  const st = statusMap[audioFile.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'group relative p-4 rounded-2xl border transition-all',
        audioFile.status === 'complete'
          ? 'bg-emerald-500/[0.04] border-emerald-500/20'
          : audioFile.status === 'error'
          ? 'bg-red-500/[0.04] border-red-500/20'
          : 'bg-white/[0.02] border-white/[0.06]',
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'p-2.5 rounded-xl shrink-0',
          audioFile.status === 'complete' ? 'bg-emerald-500/10' :
          audioFile.status === 'error' ? 'bg-red-500/10' : 'bg-indigo-500/10',
        )}>
          <FileAudio className={cn(
            'w-5 h-5',
            audioFile.status === 'complete' ? 'text-emerald-400' :
            audioFile.status === 'error' ? 'text-red-400' : 'text-indigo-400',
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white truncate">{audioFile.name}</h4>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            <span className="text-xs text-zinc-500">{formatFileSize(audioFile.size)}</span>
            {audioFile.duration != null && audioFile.duration > 0 && (
              <span className="text-xs text-zinc-500">{formatDuration(audioFile.duration)}</span>
            )}
            {audioFile.chunkStrategy && audioFile.chunkStrategy.totalChunks > 1 && (
              <span className="text-xs text-zinc-600">
                {audioFile.chunkStrategy.totalChunks} chunks
              </span>
            )}
            <span className={cn('text-xs font-medium flex items-center gap-1', st.color)}>
              <st.Icon className={cn('w-3 h-3', st.spin ? 'animate-spin' : '')} />
              {st.label}
            </span>
          </div>
          {audioFile.error && (
            <p className="text-xs text-red-400 mt-1.5 leading-relaxed break-words">{audioFile.error}</p>
          )}
          {audioFile.chunkStrategy && audioFile.status === 'queued' && audioFile.chunkStrategy.totalChunks > 1 && (
            <div className="flex items-start gap-1.5 mt-2 text-xs text-zinc-600">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{audioFile.chunkStrategy.reason}</span>
            </div>
          )}
        </div>
        {!isProcessing && audioFile.status !== 'complete' && (
          <button
            onClick={() => onRemove(audioFile.id)}
            className="p-2.5 -m-1 rounded-xl hover:bg-red-500/10 transition-all shrink-0 touch-manipulation sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={`Remove ${audioFile.name}`}
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        )}
      </div>

      {/* Progress */}
      {(audioFile.status === 'analyzing' || audioFile.status === 'chunking' || audioFile.status === 'transcribing' || audioFile.status === 'enhancing') && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #6366f1, #06b6d4, #6366f1)', backgroundSize: '200% 100%' }}
              initial={{ width: '0%' }}
              animate={{ width: `${audioFile.progress}%`, backgroundPosition: ['0% 0%', '200% 0%'] }}
              transition={{ width: { duration: 0.4 }, backgroundPosition: { duration: 2, repeat: Infinity, ease: 'linear' } }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[11px] text-zinc-500">
              {audioFile.chunks.length > 1
                ? `Chunk ${audioFile.chunks.filter(c => c.status === 'complete').length + 1} of ${audioFile.chunks.length}`
                : 'Processing...'}
            </span>
            <span className="text-[11px] text-indigo-400 font-mono">{Math.round(audioFile.progress)}%</span>
          </div>
        </div>
      )}

      {/* Waveform */}
      {audioFile.waveform.length > 0 && audioFile.status !== 'error' && (
        <div className="mt-3 opacity-40 group-hover:opacity-60 transition-opacity">
          <WaveformVis
            data={audioFile.waveform}
            color={audioFile.status === 'complete' ? '#10b981' : '#6366f1'}
            height={24}
          />
        </div>
      )}
    </motion.div>
  );
}

// ─── Results View ─────────────────────────────────────────────
function ResultsView({
  results, settings, onReset,
}: {
  results: { file: AudioFileItem; result: TranscriptionResult }[];
  settings: AppSettings;
  onReset: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'speakers' | 'export'>('transcript');
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState(settings.outputFormat);
  const [textViewMode, setTextViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [searchTerm, setSearchTerm] = useState('');

  const current = results[activeFileIdx];
  if (!current) return null;
  const { result } = current;

  const filteredSegments = useMemo(() => {
    if (!searchTerm) return result.segments;
    const lower = searchTerm.toLowerCase();
    return result.segments.filter(s => s.text.toLowerCase().includes(lower));
  }, [result.segments, searchTerm]);

  const exportContent = useMemo(() => {
    switch (exportFormat) {
      case 'txt': return exportAsText(result, settings.enableSpeakerDiarization);
      case 'md': return exportAsMarkdown(result, settings.enableSpeakerDiarization);
      case 'srt': return exportAsSRT(result);
      case 'json': return exportAsJSON(result);
    }
  }, [result, exportFormat, settings.enableSpeakerDiarization]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for mobile/older browsers
      const textarea = document.createElement('textarea');
      textarea.value = exportContent;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const ext = exportFormat === 'md' ? 'md' : exportFormat;
    const mime = exportFormat === 'json' ? 'application/json' : 'text/plain';
    const blob = new Blob([exportContent], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.file.name.replace(/\.[^/.]+$/, '')}_transcription.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Duration', value: formatDuration(result.duration), icon: Clock, accent: '#6366f1' },
          { label: 'Words', value: result.wordCount.toLocaleString(), icon: Hash, accent: '#06b6d4' },
          { label: 'Speakers', value: result.speakers.length.toString(), icon: Users, accent: '#10b981' },
          { label: 'Language', value: result.language.toUpperCase(), icon: Globe, accent: '#f59e0b' },
          { label: 'Processed in', value: `${result.processingTime.toFixed(1)}s`, icon: Brain, accent: '#8b5cf6' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn("p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]", i >= 3 && "hidden sm:block", i >= 3 && "lg:block")}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <stat.icon className="w-3.5 h-3.5" style={{ color: stat.accent }} />
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-white">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* File Tabs */}
      {results.length > 1 && (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1.5 scrollbar-hide -mx-1 px-1">
          {results.map((r, i) => (
            <button
              key={r.file.id}
              onClick={() => { setActiveFileIdx(i); setSearchTerm(''); }}
              className={cn(
                'px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all shrink-0 touch-manipulation',
                activeFileIdx === i
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'bg-white/[0.03] text-zinc-500 border border-white/[0.06]',
              )}
            >
              {r.file.name}
            </button>
          ))}
        </div>
      )}

      {/* Nav Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-2xl mb-6 border border-white/[0.04] overflow-x-auto">
        {[
          { id: 'transcript' as const, label: 'Transcript', icon: FileText },
          { id: 'speakers' as const, label: 'Speakers', icon: Users },
          { id: 'export' as const, label: 'Export', icon: Download },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-3 rounded-xl text-sm font-medium transition-all touch-manipulation',
              activeTab === tab.id
                ? 'bg-indigo-500/20 text-indigo-300 shadow-lg shadow-indigo-500/10'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* TRANSCRIPT TAB */}
      {activeTab === 'transcript' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl border border-white/[0.06] p-1">
                <button
                  onClick={() => setTextViewMode('formatted')}
                  className={cn('p-2.5 rounded-lg transition-all touch-manipulation', textViewMode === 'formatted' ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-500')}
                  title="Formatted view"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTextViewMode('raw')}
                  className={cn('p-2.5 rounded-lg transition-all touch-manipulation', textViewMode === 'raw' ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-500')}
                  title="Raw text"
                >
                  <Code className="w-4 h-4" />
                </button>
              </div>
              <div className="relative flex-1 min-w-0 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-9 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/30 transition-all"
                />
              </div>
            </div>
            <div className="flex-1" />
            <button onClick={handleCopy} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-zinc-400 hover:text-white transition-all touch-manipulation">
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy all'}
            </button>
          </div>

          {textViewMode === 'formatted' ? (
            <div className="space-y-2 max-h-[60vh] sm:max-h-[65vh] overflow-y-auto pr-1 overscroll-contain">
              {filteredSegments.map((seg, i) => (
                <motion.div
                  key={seg.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.01, 0.4) }}
                  className="group p-3 sm:p-3.5 rounded-xl bg-white/[0.015] border border-white/[0.04] hover:border-white/[0.08] transition-all"
                >
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: seg.speakerColor + '18', color: seg.speakerColor }}
                    >
                      {seg.speaker}
                    </span>
                    <span className="text-[11px] text-zinc-600 font-mono">
                      {formatTimestamp(seg.startTime)}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <div
                        className="h-1 w-8 sm:w-10 rounded-full bg-white/[0.06] overflow-hidden"
                        title={`Confidence: ${Math.round(seg.confidence * 100)}%`}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${seg.confidence * 100}%`,
                            backgroundColor: seg.confidence > 0.85 ? '#10b981' : seg.confidence > 0.65 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-600 font-mono">{Math.round(seg.confidence * 100)}%</span>
                    </div>
                  </div>
                  <p className="text-[13px] text-zinc-200 leading-relaxed">{seg.text}</p>
                </motion.div>
              ))}
              {filteredSegments.length === 0 && searchTerm && (
                <div className="text-center py-12 text-zinc-500">
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p>No matches for &ldquo;{searchTerm}&rdquo;</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 sm:p-5 rounded-xl bg-white/[0.02] border border-white/[0.04] max-h-[60vh] sm:max-h-[65vh] overflow-y-auto overscroll-contain">
              <pre className="text-xs sm:text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed break-words">
                {exportAsText(result, settings.enableSpeakerDiarization)}
              </pre>
            </div>
          )}
        </motion.div>
      )}

      {/* SPEAKERS TAB */}
      {activeTab === 'speakers' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {result.speakers.length > 0 ? (
            <>
              <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  Speaking Distribution
                </h3>
                <div className="flex h-10 rounded-xl overflow-hidden bg-white/[0.04] mb-4">
                  {result.speakers.map(speaker => (
                    <motion.div
                      key={speaker.id}
                      initial={{ width: 0 }}
                      animate={{ width: `${speaker.percentage}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full relative cursor-default"
                      style={{ backgroundColor: speaker.color }}
                      title={`${speaker.label}: ${speaker.percentage.toFixed(1)}%`}
                    >
                      {speaker.percentage > 14 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white/90">
                          {speaker.percentage.toFixed(0)}%
                        </span>
                      )}
                    </motion.div>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  {result.speakers.map(speaker => (
                    <div key={speaker.id} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: speaker.color }} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{speaker.label}</p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {formatDuration(speaker.totalDuration)} · {speaker.segmentCount} seg.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-400" />
                  Timeline
                </h3>
                <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1 overscroll-contain">
                  {result.segments.slice(0, 200).map(seg => (
                    <div key={seg.id} className="flex items-center gap-2 group">
                      <span className="text-[10px] text-zinc-600 font-mono w-[60px] sm:w-[72px] shrink-0 truncate">{formatTimestamp(seg.startTime)}</span>
                      <div
                        className="h-6 rounded flex items-center px-2 min-w-[4px] transition-all opacity-70 group-hover:opacity-100"
                        style={{
                          backgroundColor: seg.speakerColor + '25',
                          borderLeft: `3px solid ${seg.speakerColor}`,
                          width: `${Math.min(100, Math.max(8, ((seg.endTime - seg.startTime) / Math.max(result.duration, 1)) * 500))}%`,
                        }}
                      >
                        <span className="text-[11px] text-zinc-400 truncate">{seg.text.substring(0, 60)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-zinc-500">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">Turn on speaker identification in settings to see this analysis.</p>
            </div>
          )}
        </motion.div>
      )}

      {/* EXPORT TAB */}
      {activeTab === 'export' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <h3 className="text-sm font-medium text-zinc-300 mb-4">Output Format</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-6">
              {([
                { id: 'txt' as const, label: 'Plain Text', desc: '.txt file' },
                { id: 'md' as const, label: 'Markdown', desc: '.md with headings' },
                { id: 'srt' as const, label: 'Subtitles', desc: '.srt format' },
                { id: 'json' as const, label: 'JSON', desc: 'Full data' },
              ]).map(fmt => (
                <button
                  key={fmt.id}
                  onClick={() => setExportFormat(fmt.id)}
                  className={cn(
                    'p-3 sm:p-4 rounded-xl border text-left transition-all touch-manipulation',
                    exportFormat === fmt.id
                      ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20'
                      : 'bg-white/[0.02] border-white/[0.06]',
                  )}
                >
                  <p className="text-sm font-medium text-white uppercase">{fmt.id}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{fmt.desc}</p>
                </button>
              ))}
            </div>

            <div className="mb-5">
              <h4 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Preview</h4>
              <div className="p-3 sm:p-4 rounded-xl bg-black/30 border border-white/[0.04] max-h-[220px] sm:max-h-[280px] overflow-y-auto overscroll-contain">
                <pre className="text-[11px] sm:text-[12px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed break-words">
                  {exportContent.substring(0, 3000)}
                  {exportContent.length > 3000 && '\n\n…(truncated in preview)'}
                </pre>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-all shadow-lg shadow-indigo-500/20 touch-manipulation active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                Download .{exportFormat}
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-zinc-300 hover:text-white transition-all touch-manipulation active:scale-[0.98]"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Reset */}
      <div className="mt-10 text-center pb-8">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-zinc-400 hover:text-white transition-all touch-manipulation active:scale-[0.98]"
        >
          <RefreshCw className="w-4 h-4" />
          New Transcription
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [files, setFiles] = useState<AudioFileItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('upload');
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<{ file: AudioFileItem; result: TranscriptionResult }[]>([]);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const abortRef = useRef(false);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('scribe_settings', JSON.stringify(settings));
  }, [settings]);

  // Prevent accidental tab close during processing
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isProcessing]);

  // File drop handler with analysis
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const supported = acceptedFiles.filter(isSupported);
    if (supported.length === 0) return;

    setIsAnalyzing(true);
    const newFiles: AudioFileItem[] = [];

    for (const file of supported) {
      const id = generateId();
      // Create placeholder immediately for responsiveness
      const placeholder: AudioFileItem = {
        id,
        file,
        name: file.name,
        size: file.size,
        duration: null,
        status: 'queued',
        progress: 0,
        transcription: null,
        error: null,
        chunks: [],
        waveform: [],
        chunkStrategy: null,
      };
      newFiles.push(placeholder);
    }

    // Add placeholders right away
    setFiles(prev => [...prev, ...newFiles]);

    // Then analyze each asynchronously
    for (const af of newFiles) {
      try {
        const duration = await getAudioDuration(af.file);
        const waveform = await generateWaveform(af.file);
        const chunkStrategy = duration > 0 ? computeChunkStrategy(af.file, duration) : null;
        setFiles(prev => prev.map(f =>
          f.id === af.id ? { ...f, duration: duration || null, waveform, chunkStrategy } : f
        ));
      } catch {
        // Analysis failure is non-critical
      }
    }

    setIsAnalyzing(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': SUPPORTED_EXTENSIONS,
      'video/mp4': ['.mp4'],
      'video/webm': ['.webm'],
    },
    multiple: true,
    disabled: isProcessing,
  });

  const removeFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);

  const updateFile = useCallback((id: string, updates: Partial<AudioFileItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  // ─── Abort Handler ─────────────────────────────────────
  const handleAbort = useCallback(() => {
    abortRef.current = true;
  }, []);

  // ─── Transcription Pipeline ────────────────────────────
  const startTranscription = useCallback(async () => {
    const openaiKey = settings.apiKeys['openai'];
    if (!openaiKey) {
      setShowSettings(true);
      return;
    }

    const queued = files.filter(f => f.status === 'queued');
    if (queued.length === 0) return;

    setIsProcessing(true);
    setViewMode('processing');
    abortRef.current = false;

    const allResults: { file: AudioFileItem; result: TranscriptionResult }[] = [];
    const totalFiles = queued.length;

    for (let fi = 0; fi < queued.length; fi++) {
      const af = queued[fi];
      if (abortRef.current) {
        updateFile(af.id, { status: 'error', error: 'Cancelled by user' });
        continue;
      }
      const startTime = Date.now();

      try {
        // Phase 1: Analyze
        updateFile(af.id, { status: 'analyzing', progress: 3 });
        const duration = af.duration || 0;

        let strategy = af.chunkStrategy;
        if (!strategy && duration > 0) {
          strategy = computeChunkStrategy(af.file, duration);
        }
        if (!strategy) {
          strategy = {
            totalChunks: 1,
            chunkDurationSec: Math.max(duration, 600),
            reason: 'Processing as single file',
            fileSizeMB: af.size / (1024 * 1024),
            estimatedDurationMin: duration / 60,
            overlapSec: 0,
          };
        }

        if (abortRef.current) { updateFile(af.id, { status: 'error', error: 'Cancelled' }); continue; }

        // Phase 2: Chunk
        updateFile(af.id, { status: 'chunking', progress: 8, chunkStrategy: strategy });

        let chunks: AudioChunk[];
        if (strategy.totalChunks <= 1) {
          chunks = [{
            id: generateId(),
            index: 0,
            startTime: 0,
            endTime: duration,
            status: 'pending',
            blob: af.file,
            retryCount: 0,
          }];
        } else {
          chunks = await createAudioChunks(af.file, strategy, duration);
        }

        // Validate chunks
        const validChunks = chunks.filter(c => c.blob && c.blob.size > 0);
        if (validChunks.length === 0) {
          throw new Error('Could not create valid audio chunks. The file may be corrupted or in an unsupported format.');
        }

        updateFile(af.id, { chunks: validChunks, progress: 12 });

        if (abortRef.current) { updateFile(af.id, { status: 'error', error: 'Cancelled' }); continue; }

        // Phase 3: Transcribe
        updateFile(af.id, { status: 'transcribing', progress: 15 });

        const chunkResponses = [];
        for (let ci = 0; ci < validChunks.length; ci++) {
          if (abortRef.current) break;
          const chunk = validChunks[ci];

          const updatedChunks = validChunks.map((c, i) =>
            i === ci ? { ...c, status: 'processing' as const } : c
          );
          updateFile(af.id, { chunks: updatedChunks });

          let success = false;
          let lastError = '';

          for (let retry = 0; retry <= settings.maxRetries; retry++) {
            if (abortRef.current) break;
            try {
              const response = await transcribeChunk(
                chunk.blob!,
                settings,
                ci,
                chunk.startTime,
                (p) => {
                  const chunkProgress = 15 + ((ci + p / 100) / validChunks.length) * 65;
                  updateFile(af.id, { progress: chunkProgress });
                  setGlobalProgress(((fi + chunkProgress / 100) / totalFiles) * 100);
                },
              );
              chunkResponses.push(response);
              validChunks[ci] = { ...validChunks[ci], status: 'complete', retryCount: retry };
              updateFile(af.id, {
                chunks: validChunks.map((c, i) => i === ci ? { ...c, status: 'complete' as const, retryCount: retry } : c),
              });
              success = true;
              break;
            } catch (err: unknown) {
              const errorMsg = err instanceof Error ? err.message : 'Unknown error';
              lastError = errorMsg;
              validChunks[ci] = { ...validChunks[ci], retryCount: retry + 1 };
              if (retry < settings.maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retry)));
              }
            }
          }

          if (abortRef.current) break;

          if (!success) {
            validChunks[ci] = { ...validChunks[ci], status: 'error' };
            updateFile(af.id, {
              chunks: validChunks.map((c, i) => i === ci ? { ...c, status: 'error' as const } : c),
            });
            throw new Error(`Chunk ${ci + 1} failed after ${settings.maxRetries + 1} attempts: ${lastError}`);
          }
        }

        if (abortRef.current) { updateFile(af.id, { status: 'error', error: 'Cancelled' }); continue; }

        // Phase 4: Enhancement (optional)
        if (settings.enableEnhancement && settings.enhancementModel !== 'none') {
          updateFile(af.id, { status: 'enhancing', progress: 85 });
        }

        // Phase 5: Assemble
        const processingTime = (Date.now() - startTime) / 1000;
        const result = assembleTranscription(chunkResponses, settings, settings.transcriptionModel, processingTime);

        if (settings.enableEnhancement && settings.enhancementModel !== 'none') {
          try {
            const enhanced = await enhanceTranscription(result.fullText, settings);
            if (enhanced && enhanced !== result.fullText) {
              result.fullText = enhanced;
            }
          } catch {
            // Enhancement failure is non-critical
          }
        }

        updateFile(af.id, { status: 'complete', progress: 100, transcription: result });
        allResults.push({ file: af, result });

      } catch (err: unknown) {
        if (!abortRef.current) {
          const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
          updateFile(af.id, { status: 'error', error: errorMsg, progress: 0 });
        }
      }

      setGlobalProgress(((fi + 1) / totalFiles) * 100);
    }

    setIsProcessing(false);
    abortRef.current = false;

    if (allResults.length > 0) {
      setResults(allResults);
      setViewMode('results');
    }
  }, [files, settings, updateFile]);

  const resetApp = useCallback(() => {
    setFiles([]);
    setResults([]);
    setViewMode('upload');
    setGlobalProgress(0);
  }, []);

  const hasFiles = files.length > 0;
  const hasQueued = files.some(f => f.status === 'queued');
  const hasOpenAIKey = !!settings.apiKeys['openai'];

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#07070b] text-white relative overflow-x-hidden">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[10%] w-[500px] h-[500px] bg-indigo-500/[0.035] rounded-full blur-[150px]" />
        <div className="absolute bottom-[-10%] right-[15%] w-[400px] h-[400px] bg-cyan-500/[0.025] rounded-full blur-[130px]" />
        <div className="absolute top-[40%] right-[30%] w-[250px] h-[250px] bg-violet-500/[0.02] rounded-full blur-[100px]" />
        <div
          className="fixed inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.04] sticky top-0 bg-[#07070b]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mic className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-white" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-semibold text-white tracking-tight">Transcriber</h1>
              <p className="text-[10px] sm:text-[11px] text-zinc-500 -mt-0.5 hidden sm:block">Audio to text, done right</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isProcessing && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  <span className="text-xs sm:text-sm text-indigo-300 font-medium font-mono">{Math.round(globalProgress)}%</span>
                </div>
                <button
                  onClick={handleAbort}
                  className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all touch-manipulation"
                  title="Stop processing"
                >
                  <StopCircle className="w-4 h-4 text-red-400" />
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className={cn(
                'p-2.5 rounded-xl transition-all touch-manipulation',
                hasOpenAIKey
                  ? 'bg-white/[0.04] hover:bg-white/[0.07] text-zinc-400 hover:text-white border border-white/[0.06]'
                  : 'bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse',
              )}
              title={hasOpenAIKey ? 'Settings' : 'Add API key to start'}
            >
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <AnimatePresence mode="wait">
          {/* ─── UPLOAD VIEW ─── */}
          {viewMode === 'upload' && (
            <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Hero */}
              {!hasFiles && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="text-center mb-10 sm:mb-14 pt-6 sm:pt-10"
                >
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/[0.08] border border-indigo-500/15 mb-5 sm:mb-6">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[11px] sm:text-xs font-medium text-zinc-400">
                      GPT-4o · Whisper · Claude · DeepSeek
                    </span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl md:text-[3.2rem] font-bold mb-4 sm:mb-5 tracking-tight leading-[1.1]">
                    <span className="bg-gradient-to-r from-indigo-300 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                      Turn any recording
                    </span>
                    <br />
                    <span className="text-white">into readable text.</span>
                  </h2>
                  <p className="text-sm sm:text-base md:text-lg text-zinc-500 max-w-xl mx-auto leading-relaxed px-2">
                    Drop your audio in. It handles the rest — chunking large files,
                    identifying speakers, and giving you clean output you can actually use.
                  </p>
                </motion.div>
              )}

              {/* Drop Zone */}
              <div
                {...getRootProps()}
                className={cn(
                  'relative group cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300',
                  isDragActive
                    ? 'border-indigo-500/60 bg-indigo-500/[0.04] scale-[1.005]'
                    : 'border-white/[0.08] hover:border-indigo-500/30 hover:bg-white/[0.01]',
                  hasFiles ? 'p-5 sm:p-7' : 'p-8 sm:p-10 md:p-16',
                  isProcessing && 'pointer-events-none opacity-50',
                )}
              >
                <input {...getInputProps()} />
                <div className="relative z-10 text-center">
                  <div className={cn(
                    'mx-auto mb-3 sm:mb-4 rounded-2xl flex items-center justify-center transition-all',
                    isDragActive ? 'bg-indigo-500/15 scale-110' : 'bg-white/[0.04]',
                    hasFiles ? 'w-10 h-10 sm:w-11 sm:h-11' : 'w-12 h-12 sm:w-14 sm:h-14',
                  )}>
                    {isAnalyzing ? (
                      <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    ) : (
                      <Upload className={cn(
                        'transition-all',
                        isDragActive ? 'text-indigo-400' : 'text-zinc-500',
                        hasFiles ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-5 h-5 sm:w-6 sm:h-6',
                      )} />
                    )}
                  </div>
                  <h3 className={cn('font-medium text-white mb-1', hasFiles ? 'text-sm' : 'text-base sm:text-lg')}>
                    {isAnalyzing ? 'Analyzing files...' : isDragActive ? 'Drop to add' : hasFiles ? 'Add more files' : 'Drop audio files here'}
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-500">
                    or tap to browse · MP3, WAV, M4A, FLAC, OGG, OPUS, MP4, WebM
                  </p>
                  {!hasFiles && (
                    <p className="text-[11px] sm:text-xs text-zinc-600 mt-2">
                      No size limit. Large files split automatically.
                    </p>
                  )}
                </div>
              </div>

              {/* File List */}
              {hasFiles && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 sm:mt-6">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <h3 className="text-sm font-medium text-zinc-300">
                      {files.length} file{files.length !== 1 ? 's' : ''} ready
                    </h3>
                    <button
                      onClick={() => setFiles([])}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-1 -mr-2 touch-manipulation"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="grid gap-2.5">
                    <AnimatePresence>
                      {files.map(f => (
                        <FileCard key={f.id} audioFile={f} onRemove={removeFile} isProcessing={isProcessing} />
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Start Button */}
                  {hasQueued && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 sm:mt-8 text-center">
                      <button
                        onClick={startTranscription}
                        disabled={isProcessing || !hasOpenAIKey}
                        className={cn(
                          'inline-flex items-center gap-2.5 sm:gap-3 px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl font-semibold text-sm sm:text-base transition-all touch-manipulation',
                          'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white',
                          'hover:shadow-xl hover:shadow-indigo-500/25 hover:scale-[1.02]',
                          'active:scale-[0.98]',
                          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
                          'shadow-lg shadow-indigo-500/15',
                        )}
                      >
                        {isProcessing ? (
                          <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
                        ) : (
                          <><Zap className="w-5 h-5" /> Start Transcription <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" /></>
                        )}
                      </button>
                      {!hasOpenAIKey && (
                        <button
                          onClick={() => setShowSettings(true)}
                          className="block mx-auto mt-3 text-xs text-amber-400 flex items-center justify-center gap-1.5 touch-manipulation py-1"
                        >
                          <AlertCircle className="w-3.5 h-3.5" />
                          Add your OpenAI API key in settings to start
                        </button>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* Feature Cards */}
              {!hasFiles && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-10 sm:mt-14">
                  {[
                    {
                      icon: Layers, color: '#6366f1',
                      title: 'Handles any file size',
                      desc: 'Analyzes bitrate and duration to split audio into optimized segments. Each chunk stays under API limits with overlap for seamless joins.',
                    },
                    {
                      icon: Users, color: '#06b6d4',
                      title: 'Knows who\'s talking',
                      desc: 'Detects speaker changes based on pauses and speech patterns. Color-coded labels make long conversations easy to follow.',
                    },
                    {
                      icon: Download, color: '#10b981',
                      title: 'Export how you want',
                      desc: 'Copy to clipboard or download as plain text, Markdown with structure, SRT subtitles, or raw JSON with every data point.',
                    },
                  ].map((feature, i) => (
                    <motion.div
                      key={feature.title}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + i * 0.07 }}
                      className="p-5 sm:p-6 rounded-2xl bg-white/[0.015] border border-white/[0.05] hover:border-white/[0.1] transition-all group"
                    >
                      <feature.icon className="w-6 h-6 sm:w-7 sm:h-7 mb-3 group-hover:scale-110 transition-transform" style={{ color: feature.color }} />
                      <h4 className="font-semibold text-white mb-1.5 text-sm sm:text-[15px]">{feature.title}</h4>
                      <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed">{feature.desc}</p>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Model List */}
              {!hasFiles && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="mt-8 sm:mt-10 p-4 sm:p-5 rounded-2xl bg-white/[0.015] border border-white/[0.04]"
                >
                  <h3 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2">
                    <ChevronRight className="w-3.5 h-3.5" />
                    Supported Models
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {PROVIDERS.flatMap(p => p.models.map(m => (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]"
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-[11px] text-zinc-400">{m.label}</span>
                        {m.isLatest && <span className="text-[9px] text-emerald-400/70">●</span>}
                      </div>
                    )))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ─── PROCESSING VIEW ─── */}
          {viewMode === 'processing' && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-3xl mx-auto">
              <div className="text-center mb-8 pt-4 sm:pt-6">
                <div className="relative inline-flex mb-5">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-xl shadow-indigo-500/25">
                    <Brain className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 animate-ping opacity-15" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white mb-1.5">Working on it</h2>
                <p className="text-sm text-zinc-500">Using {settings.transcriptionModel}</p>
              </div>

              {/* Global Progress */}
              <div className="mb-6 sm:mb-8 p-4 sm:p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-zinc-300 font-medium">Overall</span>
                  <span className="text-sm text-indigo-400 font-mono font-semibold">{Math.round(globalProgress)}%</span>
                </div>
                <div className="h-2.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, #6366f1, #06b6d4)' }}
                    animate={{ width: `${globalProgress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>

              <div className="grid gap-2.5">
                {files.map(f => (
                  <FileCard key={f.id} audioFile={f} onRemove={removeFile} isProcessing={isProcessing} />
                ))}
              </div>

              {/* Abort Button */}
              <div className="mt-6 text-center">
                <button
                  onClick={handleAbort}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all touch-manipulation active:scale-[0.98]"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop Processing
                </button>
              </div>

              {settings.enableEnhancement && settings.enhancementModel !== 'none' && (
                <div className="mt-6 p-3.5 rounded-xl bg-violet-500/[0.05] border border-violet-500/10 flex items-start gap-3">
                  <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    After transcription, text will be refined through <span className="text-violet-300 font-medium">{settings.enhancementModel}</span>.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── RESULTS VIEW ─── */}
          {viewMode === 'results' && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResultsView results={results} settings={settings} onReset={resetApp} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Drawer */}
      <SettingsPanel settings={settings} setSettings={setSettings} isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] mt-12 sm:mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
          <p className="text-[11px] sm:text-xs text-zinc-600">
            Files go directly to each provider's API. Nothing stored elsewhere.
          </p>
          <div className="flex items-center gap-3 sm:gap-4">
            {hasOpenAIKey ? (
              <span className="text-[11px] sm:text-xs text-zinc-600 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                OpenAI connected
              </span>
            ) : (
              <span className="text-[11px] sm:text-xs text-zinc-600 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                No API key
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

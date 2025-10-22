import { useEffect, useMemo, useRef, useState } from 'react';

interface WaveformTrimProps {
  src: string;
  height?: number;
  initialStart?: number; // seconds
  initialEnd?: number;   // seconds
  filenameBase?: string;
}

function encodeWav(buffer: AudioBuffer, start = 0, end?: number): Blob {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(buffer.length, Math.floor((end ?? buffer.duration) * sampleRate));
  const length = Math.max(0, to - from);

  // Interleave channels to 16-bit PCM
  const bytesPerSample = 2;
  const dataLength = length * channels * bytesPerSample;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // PCM data
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const src = buffer.getChannelData(ch).subarray(from, to);
    channelData.push(src);
  }
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });

  function writeString(dv: DataView, pos: number, str: string) {
    for (let i = 0; i < str.length; i++) dv.setUint8(pos + i, str.charCodeAt(i));
  }
}

export function WaveformTrim({ src, height = 56, initialStart = 0, initialEnd, filenameBase = 'clip' }: WaveformTrimProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [start, setStart] = useState<number>(initialStart);
  const [end, setEnd] = useState<number | null>(initialEnd ?? null);
  const [loop, setLoop] = useState(false);
  const [loading, setLoading] = useState(false);

  // Decode and build peaks
  const peaks = useMemo(() => ({ data: [] as number[], ready: false }), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(src, { cache: 'force-cache' });
        const arr = await res.arrayBuffer();
        const audioCtx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!audioCtx) {
          return;
        }
        const ctx = new audioCtx();
        const audioBuffer = await ctx.decodeAudioData(arr);
        if (cancelled) return;
        setBuffer(audioBuffer);
        setDuration(audioBuffer.duration);
        if (!end) setEnd(audioBuffer.duration);
        // Build simple RMS peaks
        const samples = Math.min(600, Math.max(120, Math.floor(audioBuffer.duration * 60)));
        const step = Math.floor(audioBuffer.length / samples);
        const data: number[] = [];
        const ch0 = audioBuffer.getChannelData(0);
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          const startIndex = i * step;
          const stop = Math.min(ch0.length, startIndex + step);
          for (let j = startIndex; j < stop; j++) sum += Math.abs(ch0[j]);
          data.push(sum / (stop - startIndex || 1));
        }
        peaks.data = data.map((v) => Math.min(1, v * 4));
        peaks.ready = true;
        draw();
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, peaks.ready]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const h = height * dpr;
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, h);
    // background line
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(0, (h / 2) - 1, width, 2);
    if (!peaks.ready || peaks.data.length === 0) return;
    const bars = peaks.data.length;
    const barWidth = Math.max(1, Math.floor(width / bars));
    const center = h / 2;
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    for (let i = 0; i < bars; i++) {
      const x = i * barWidth;
      const amp = peaks.data[i];
      const y = amp * (h * 0.45);
      ctx.fillRect(x, center - y, Math.max(1, barWidth - 1), y * 2);
    }
    // selection overlay
    if (duration && start != null && end != null) {
      const sx = Math.max(0, Math.min(1, start / duration)) * width;
      const ex = Math.max(0, Math.min(1, end / duration)) * width;
      ctx.fillStyle = 'rgba(59,130,246,0.25)';
      ctx.fillRect(Math.min(sx, ex), 0, Math.abs(ex - sx), h);
    }
  };

  useEffect(() => {
    if (!loop) return;
    const audio = audioRef.current || (audioRef.current = new Audio(src));
    const onTime = () => {
      if (end != null && audio.currentTime >= end - 0.02) {
        audio.currentTime = Math.max(0, start);
        audio.play().catch(() => undefined);
      }
    };
    audio.addEventListener('timeupdate', onTime);
    return () => audio.removeEventListener('timeupdate', onTime);
  }, [start, end, loop, src]);

  const handlePlay = () => {
    const audio = audioRef.current || (audioRef.current = new Audio(src));
    if (audio.paused) {
      audio.currentTime = Math.max(0, start);
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const handleExport = async () => {
    if (!buffer) return;
    const blob = encodeWav(buffer, start, end ?? buffer.duration);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const humanStart = Math.max(0, start).toFixed(2);
    const humanEnd = (end ?? buffer.duration).toFixed(2);
    a.download = `${filenameBase}-trim_${humanStart}-${humanEnd}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  };

  return (
    <div className="waveform-trim">
      <canvas ref={canvasRef} className="waveform-trim__canvas" style={{ height }} />
      <div className="waveform-trim__controls">
        <label>
          Start
          <input type="range" min={0} max={Math.max(0.1, end ?? duration)} step={0.05} value={Math.min(start, (end ?? duration) - 0.05)} onChange={(e) => setStart(Math.min(Number(e.target.value), (end ?? duration) - 0.05))} />
        </label>
        <label>
          End
          <input type="range" min={Math.min(start + 0.05, duration)} max={duration || 0.1} step={0.05} value={Math.min(end ?? duration, duration)} onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.05))} />
        </label>
        <button type="button" className="small-btn" onClick={() => setLoop((v) => !v)} aria-pressed={loop}>
          {loop ? 'Looping' : 'Loop'}
        </button>
        <button type="button" className="small-btn" onClick={handlePlay} disabled={loading}>
          Play/Pause
        </button>
        <button type="button" className="small-btn" onClick={handleExport} disabled={!buffer || loading}>
          Export selection
        </button>
      </div>
    </div>
  );
}

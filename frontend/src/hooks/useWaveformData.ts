import { useEffect, useRef, useState } from 'react';

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioCtx;
}

export interface WaveformData {
  peaks: Float32Array | null;
  duration: number;
  error: string | null;
}

/**
 * Decode audio from a URL and compute a fixed-length mono peak envelope.
 * Returns a Float32Array of length `bins` with values in [0, 1].
 */
export function useWaveformData(url: string | null, bins = 1024): WaveformData {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;
    setPeaks(null);
    setDuration(0);
    setError(null);
    if (!url) return () => { abortedRef.current = true; };

    // Avoid redundant work if URL hasn't changed
    if (lastUrlRef.current === url && peaks) {
      return () => { abortedRef.current = true; };
    }
    lastUrlRef.current = url;

    (async () => {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        const arr = await res.arrayBuffer();
        const ctx = getAudioContext();
        const buf = await ctx.decodeAudioData(arr.slice(0));
        if (abortedRef.current) return;
        const channels = new Array(buf.numberOfChannels).fill(0).map((_, i) => buf.getChannelData(i));
        const totalLen = buf.length;
        const step = Math.max(1, Math.floor(totalLen / bins));
        const out = new Float32Array(bins);
        for (let i = 0; i < bins; i += 1) {
          const start = i * step;
          let max = 0;
          const end = Math.min(totalLen, start + step);
          for (let s = start; s < end; s += 1) {
            let sample = 0;
            for (let c = 0; c < channels.length; c += 1) sample += channels[c][s] || 0;
            sample = sample / channels.length;
            const v = Math.abs(sample);
            if (v > max) max = v;
          }
          out[i] = max;
        }
        // Normalize to [0,1]
        let peak = 0;
        for (let i = 0; i < bins; i += 1) if (out[i] > peak) peak = out[i];
        if (peak > 0) {
          for (let i = 0; i < bins; i += 1) out[i] = out[i] / peak;
        }
        setPeaks(out);
        setDuration(buf.duration || 0);
      } catch (err) {
        if (!abortedRef.current) setError(err instanceof Error ? err.message : 'Failed to decode audio');
      }
    })();

    return () => { abortedRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { peaks, duration, error };
}


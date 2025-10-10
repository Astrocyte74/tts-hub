import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import clsx from 'clsx';

interface WaveformPlayerProps {
  src: string;
  autoPlay?: boolean;
  height?: number;
  waveColor?: string;
  progressColor?: string;
}

export function WaveformPlayer({
  src,
  autoPlay = false,
  height = 80,
  waveColor = '#a1a1aa',
  progressColor = '#2563eb',
}: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    setIsReady(false);
    setIsPlaying(false);

    const instance = WaveSurfer.create({
      container: containerRef.current,
      url: src,
      height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      waveColor,
      progressColor,
      cursorColor: 'rgba(255,255,255,0.0)',
    });

    waveSurferRef.current = instance;

    const handleReady = () => {
      setIsReady(true);
      if (autoPlay) {
        instance.play();
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleFinish = () => setIsPlaying(false);

    instance.on('ready', handleReady);
    instance.on('play', handlePlay);
    instance.on('pause', handlePause);
    instance.on('finish', handleFinish);

    return () => {
      instance.unAll();
      instance.destroy();
      waveSurferRef.current = null;
    };
  }, [autoPlay, height, progressColor, src, waveColor]);

  const togglePlayback = () => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer || !isReady) {
      return;
    }
    if (waveSurfer.isPlaying()) {
      waveSurfer.pause();
    } else {
      waveSurfer.play();
    }
  };

  return (
    <div className="waveform-player">
      <button
        type="button"
        className={clsx('waveform-player__button', { 'is-disabled': !isReady })}
        onClick={togglePlayback}
        disabled={!isReady}
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <div className="waveform-player__canvas" ref={containerRef} />
    </div>
  );
}

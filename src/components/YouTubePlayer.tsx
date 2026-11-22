import { useEffect, useRef, useState } from 'react';
import {
  LocateFixed,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Video,
} from 'lucide-react';
import { extractYouTubeVideoId, formatTimestamp } from '../utils/arabic';

export type VideoPlayerSyncState =
  | 'unstarted'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended';

export interface VideoTimeSyncInfo {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playerState: VideoPlayerSyncState;
  wasSeek: boolean;
}

interface YTPlayerInstance {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: () => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState?: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace | null> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    const prevCallback = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      resolve(window.YT?.Player ? window.YT : null);
    }, 6000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      prevCallback?.();
      resolve(window.YT?.Player ? window.YT : null);
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

function mapYtState(code: number): VideoPlayerSyncState {
  if (code === 1) return 'playing';
  if (code === 2) return 'paused';
  if (code === 3) return 'buffering';
  if (code === 0) return 'ended';
  return 'unstarted';
}

interface YouTubePlayerProps {
  youtubeUrl: string;
  title: string;
  fallbackDurationSeconds?: number;
  seekRequest: { seconds: number; nonce: number } | null;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onTimeSync: (info: VideoTimeSyncInfo) => void;
}

export function YouTubePlayer({
  youtubeUrl,
  title,
  fallbackDurationSeconds = 240,
  seekRequest,
  autoScroll,
  onToggleAutoScroll,
  onTimeSync,
}: YouTubePlayerProps) {
  const videoId = extractYouTubeVideoId(youtubeUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const lastTimeRef = useRef(0);
  const lastPollAtRef = useRef(Date.now());
  const onTimeSyncRef = useRef(onTimeSync);

  const [apiReady, setApiReady] = useState(false);
  const [apiFallback, setApiFallback] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDurationSeconds);
  const [playerState, setPlayerState] = useState<VideoPlayerSyncState>('unstarted');

  useEffect(() => {
    onTimeSyncRef.current = onTimeSync;
  }, [onTimeSync]);

  useEffect(() => {
    if (!videoId) return;
    let disposed = false;
    let pollTimer: number | null = null;

    setApiReady(false);
    setApiFallback(false);
    setCurrentTime(0);
    setDuration(fallbackDurationSeconds);
    setPlayerState('unstarted');
    lastTimeRef.current = 0;

    const emitSync = (player: YTPlayerInstance, state: VideoPlayerSyncState, forceSeek = false) => {
      try {
        const rawTime = player.getCurrentTime?.();
        const rawDur = player.getDuration?.();
        const safeTime = typeof rawTime === 'number' && Number.isFinite(rawTime) ? Math.max(0, rawTime) : 0;
        const safeDur =
          typeof rawDur === 'number' && Number.isFinite(rawDur) && rawDur > 0
            ? rawDur
            : fallbackDurationSeconds;

        const now = Date.now();
        const wallElapsed = (now - lastPollAtRef.current) / 1000;
        const delta = safeTime - lastTimeRef.current;
        const jumpedUnexpectedly =
          forceSeek || Math.abs(delta) > Math.max(0.75, wallElapsed * 2.2);

        lastTimeRef.current = safeTime;
        lastPollAtRef.current = now;

        setCurrentTime(safeTime);
        setDuration(safeDur);
        setPlayerState(state);

        onTimeSyncRef.current({
          currentTime: safeTime,
          duration: safeDur,
          isPlaying: state === 'playing',
          playerState: state,
          wasSeek: jumpedUnexpectedly,
        });
      } catch {
        // Ignore transient YT player read errors during destroy
      }
    };

    loadYouTubeIframeApi().then((YT) => {
      if (disposed) return;
      if (!YT?.Player || !containerRef.current) {
        setApiFallback(true);
        return;
      }

      const mountNode = document.createElement('div');
      mountNode.className = 'h-full w-full';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountNode);

      try {
        const instance = new YT.Player(mountNode, {
          videoId,
          host: 'https://www.youtube.com',
          playerVars: {
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            playsinline: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: (ev) => {
              if (disposed) return;
              playerRef.current = ev.target;
              setApiReady(true);
              emitSync(ev.target, 'unstarted', false);

              // Continuously poll so even timeline scrubs while paused or buffering sync immediately
              pollTimer = window.setInterval(() => {
                if (disposed || !playerRef.current) return;
                const st = mapYtState(playerRef.current.getPlayerState?.() ?? -1);
                emitSync(playerRef.current, st, false);
              }, 120);
            },
            onStateChange: (ev) => {
              if (disposed) return;
              const nextState = mapYtState(ev.data);
              emitSync(ev.target, nextState, nextState === 'buffering');
            },
            onError: () => {
              if (!disposed) setApiFallback(true);
            },
          },
        });
        playerRef.current = instance;
      } catch {
        setApiFallback(true);
      }
    });

    return () => {
      disposed = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      try {
        playerRef.current?.destroy?.();
      } catch {
        // Ignore cleanup errors
      }
      playerRef.current = null;
    };
  }, [videoId, fallbackDurationSeconds]);

  // Handle imperative seek requests from clicking transcript timestamps or scrubber
  useEffect(() => {
    if (!seekRequest || !playerRef.current || !apiReady) return;
    const targetSec = Math.max(0, Math.min(duration || 36000, seekRequest.seconds));
    try {
      playerRef.current.seekTo(targetSec, true);
      lastTimeRef.current = targetSec;
      lastPollAtRef.current = Date.now();
      setCurrentTime(targetSec);
      const st = mapYtState(playerRef.current.getPlayerState?.() ?? -1);
      onTimeSyncRef.current({
        currentTime: targetSec,
        duration: duration || fallbackDurationSeconds,
        isPlaying: st === 'playing',
        playerState: st,
        wasSeek: true,
      });
    } catch {
      // Ignore seek before ready
    }
  }, [seekRequest, apiReady, duration, fallbackDurationSeconds]);

  if (!videoId) return null;

  const handleTogglePlay = () => {
    if (!playerRef.current || !apiReady) return;
    if (playerState === 'playing') {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const handleSeekTo = (seconds: number) => {
    const clamped = Math.max(0, Math.min(duration || fallbackDurationSeconds, seconds));
    setCurrentTime(clamped);
    if (playerRef.current && apiReady) {
      playerRef.current.seekTo(clamped, true);
      lastTimeRef.current = clamped;
      lastPollAtRef.current = Date.now();
      onTimeSyncRef.current({
        currentTime: clamped,
        duration: duration || fallbackDurationSeconds,
        isPlaying: playerState === 'playing',
        playerState,
        wasSeek: true,
      });
    }
  };

  return (
    <div className="border-b border-[#DCE5D3] bg-[#1D2715] px-4 py-5 sm:px-10 sm:py-6 space-y-3">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-white/12 bg-black aspect-video shadow-lg">
        {apiFallback ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        ) : (
          <div ref={containerRef} className="h-full w-full" aria-label={title} />
        )}
      </div>

      {/* Synced Playback Status & Scrubbing Bar */}
      <div
        dir="ltr"
        className="mx-auto max-w-3xl rounded-xl border border-white/15 bg-[#2A3820]/90 px-4 py-2.5 text-xs text-[#EEF2E9] space-y-2 backdrop-blur-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                playerState === 'playing'
                  ? 'bg-[#E8B948] ring-3 ring-[#E8B948]/35 animate-pulse'
                  : playerState === 'buffering'
                    ? 'bg-amber-400 animate-pulse'
                    : apiReady
                      ? 'bg-emerald-400'
                      : 'bg-[#DCE5D3]/60'
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-white">
              {playerState === 'playing'
                ? 'Transcript Synced · Playing'
                : playerState === 'buffering'
                  ? 'Resyncing Timestamp...'
                  : playerState === 'paused'
                    ? 'Transcript Synced · Paused'
                    : playerState === 'ended'
                      ? 'Video Ended'
                      : apiReady
                        ? 'Transcript Sync Ready'
                        : 'Connecting Video Sync...'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {apiReady && (
              <>
                <button
                  type="button"
                  onClick={() => handleSeekTo(currentTime - 10)}
                  title="Rewind 10s"
                  aria-label="Rewind 10 seconds"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-mono text-[#EEF2E9] hover:bg-white/20 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>-10s</span>
                </button>
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={playerState === 'playing' ? 'Pause video' : 'Play video'}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#D4A338] px-2.5 py-1 text-[11px] font-bold text-[#1F2718] hover:bg-[#E8B948] transition-colors cursor-pointer"
                >
                  {playerState === 'playing' ? (
                    <>
                      <Pause className="h-3 w-3" aria-hidden="true" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" aria-hidden="true" />
                      <span>Play</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleSeekTo(currentTime + 10)}
                  title="Forward 10s"
                  aria-label="Forward 10 seconds"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-mono text-[#EEF2E9] hover:bg-white/20 transition-colors cursor-pointer"
                >
                  <span>+10s</span>
                  <RotateCw className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onToggleAutoScroll}
              aria-pressed={autoScroll}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                autoScroll
                  ? 'bg-[#E8B948]/20 text-[#FBF3DC] border border-[#E8B948]/45'
                  : 'bg-white/5 text-[#DCE5D3]/80 border border-white/15 hover:text-white'
              }`}
            >
              <LocateFixed className="h-3 w-3" aria-hidden="true" />
              <span>Auto-Scroll: {autoScroll ? 'On' : 'Off'}</span>
            </button>
          </div>
        </div>

        {/* Interactive Sync Scrubber */}
        {apiReady && duration > 0 ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-[#E8B948] w-11">
              {formatTimestamp(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={0.5}
              value={Math.min(currentTime, duration)}
              onChange={(e) => handleSeekTo(Number(e.target.value))}
              aria-label="Video timeline scrubber"
              className="h-1.5 flex-1 accent-[#E8B948] cursor-pointer"
            />
            <span className="font-mono text-[11px] tabular-nums text-[#DCE5D3] w-11 text-right">
              {formatTimestamp(duration)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[#DCE5D3]/85">
            <Video className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
            <span>
              Click any timestamp badge in the Arabic transcript below to jump directly to that moment.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

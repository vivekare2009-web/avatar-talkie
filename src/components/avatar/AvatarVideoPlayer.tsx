import { useCallback, useEffect, useRef, useState } from "react";

import { isTransient, type AvatarState } from "@/lib/companion/avatarStates";
import { cn } from "@/lib/utils";

export type AvatarVideoPlayerProps = {
  state: AvatarState;
  sources: Partial<Record<AvatarState, string>>;
  onTransientEnded: (state: AvatarState) => void;
  onLog?: (message: string) => void;
  className?: string;
};

/** Hard guarantee: avatar clips are always silent. */
function enforceMuted(video: HTMLVideoElement | null) {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
}

/**
 * Double-buffered video surface. The incoming clip is loaded on the hidden
 * element and only swapped in once it can actually play, which removes the
 * blank-frame flash. Every load carries a token so a late `play()` promise or
 * `canplay` event from an abandoned source can never take over.
 */
export function AvatarVideoPlayer({
  state,
  sources,
  onTransientEnded,
  onLog,
  className,
}: AvatarVideoPlayerProps) {
  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const [front, setFront] = useState<0 | 1>(0);
  const frontRef = useRef<0 | 1>(0);
  const [visibleState, setVisibleState] = useState<AvatarState | null>(null);
  const visibleStateRef = useRef<AvatarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadToken = useRef(0);
  const currentSrc = useRef<string | null>(null);

  const log = useCallback(
    (message: string) => {
      onLog?.(message);
    },
    [onLog],
  );

  const src = sources[state] ?? null;

  useEffect(() => {
    const token = ++loadToken.current;
    const nextFront = frontRef.current === 0 ? 1 : 0;
    const target = nextFront === 1 ? videoB.current : videoA.current;
    const showing = nextFront === 1 ? videoA.current : videoB.current;

    enforceMuted(videoA.current);
    enforceMuted(videoB.current);

    if (!src) {
      currentSrc.current = null;
      setVisibleState(null);
      visibleStateRef.current = null;
      setLoading(false);
      if (showing) {
        showing.pause();
        showing.removeAttribute("src");
        showing.load();
      }
      return;
    }

    if (currentSrc.current === src && visibleStateRef.current === state) return;
    if (!target) return;

    let cancelled = false;
    let pauseTimer: number | undefined;
    setLoading(true);
    setError(null);

    const cleanup = () => {
      target.removeEventListener("canplay", handleReady);
      target.removeEventListener("error", handleError);
    };

    function handleReady() {
      if (cancelled || token !== loadToken.current) return;
      cleanup();
      enforceMuted(target);
      const nextVideo = target;
      if (!nextVideo) return;
      nextVideo.loop = !isTransient(state);
      const playPromise = nextVideo.play();
      const swap = () => {
        if (cancelled || token !== loadToken.current) return;
        currentSrc.current = src;
        setVisibleState(state);
        visibleStateRef.current = state;
        frontRef.current = nextFront;
        setFront(frontRef.current);
        setLoading(false);
        log(`clip ready: ${state}`);
        if (showing) {
          pauseTimer = window.setTimeout(() => {
            if (showing !== (frontRef.current === 0 ? videoA.current : videoB.current)) showing.pause();
          }, 150);
        }
      };
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(swap).catch(() => {
          if (cancelled || token !== loadToken.current) return;
          // Autoplay is allowed for muted video; if it still fails, show the frame.
          swap();
          log(`autoplay blocked for ${state}; showing first frame`);
        });
      } else {
        swap();
      }
    }

    function handleError() {
      if (cancelled || token !== loadToken.current) return;
      cleanup();
      setLoading(false);
      setError(`The ${state} clip could not be played. Re-upload it in Settings.`);
      log(`clip failed: ${state}`);
    }

    target.addEventListener("canplay", handleReady);
    target.addEventListener("error", handleError);
    target.pause();
    target.src = src;
    enforceMuted(target);
    target.playsInline = true;
    target.load();

    return () => {
      cancelled = true;
      cleanup();
      if (pauseTimer) window.clearTimeout(pauseTimer);
      if (target !== (frontRef.current === 0 ? videoA.current : videoB.current)) target.pause();
    };
  }, [src, state, log]);

  // Re-assert muting after any source change or browser interference.
  useEffect(() => {
    const interval = window.setInterval(() => {
      enforceMuted(videoA.current);
      enforceMuted(videoB.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      for (const video of [videoA.current, videoB.current]) {
        if (!video) continue;
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, []);

  const handleEnded = useCallback((index: number) => {
    const playing = visibleStateRef.current;
    if (index === frontRef.current && playing === state && isTransient(playing)) onTransientEnded(playing);
  }, [state, onTransientEnded]);

  return (
    <div data-visible-state={visibleState} className={cn("relative h-full w-full overflow-hidden bg-surface-deep", className)}>
      {[videoA, videoB].map((ref, index) => (
        <video
          key={index}
          ref={ref}
          muted
          playsInline
          preload="auto"
          onEnded={() => handleEnded(index)}
          onVolumeChange={(event) => enforceMuted(event.currentTarget)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-150",
            front === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}

      {!src && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-foreground">No clip for “{state}” yet</p>
          <p className="text-xs text-muted-foreground">
            Upload the original video files in Settings → Avatar clips. Nothing is faked here.
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      )}

      {loading && src && (
        <div className="absolute right-3 top-3 rounded-full bg-surface-deep/70 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          loading
        </div>
      )}
    </div>
  );
}

import { type Signal, get, set } from '../reactivity/state';
import { effect } from '../reactivity/effect';
import { listen } from './shared';

// ── Two-way bindings ───────────────────────────────────────────────

function timeRangesToArray(ranges: TimeRanges): { start: number; end: number }[] {
    const arr: { start: number; end: number }[] = [];
    for (let i = 0; i < ranges.length; i++) {
        arr.push({ start: ranges.start(i), end: ranges.end(i) });
    }
    return arr;
}

export function bindCurrentTime(media: HTMLMediaElement, signal: Signal<number>): void {
    let raf: number;
    let value: number;

    const callback = () => {
        cancelAnimationFrame(raf);
        if (!media.paused) {
            raf = requestAnimationFrame(callback);
        }
        const next = media.currentTime;
        if (value !== next) {
            set(signal, (value = next));
        }
    };

    raf = requestAnimationFrame(callback);
    media.addEventListener('timeupdate', callback);

    effect(() => {
        const next = get(signal);
        if (value !== next && !isNaN(next)) {
            media.currentTime = value = next;
        }
    });
}

export function bindPaused(media: HTMLMediaElement, signal: Signal<boolean>): void {
    let paused = get(signal);

    listen(media, ['play', 'pause', 'canplay'], () => {
        if (paused !== media.paused) {
            set(signal, (paused = media.paused));
        }
    }, paused == null);

    effect(() => {
        if ((paused = !!get(signal)) !== media.paused) {
            if (paused) {
                media.pause();
            } else {
                media.play().catch(() => {});
            }
        }
    });
}

export function bindVolume(media: HTMLMediaElement, signal: Signal<number>): void {
    listen(media, ['volumechange'], () => {
        set(signal, media.volume);
    }, get(signal) == null);

    effect(() => {
        const value = get(signal);
        if (value !== media.volume && !isNaN(value)) {
            media.volume = value;
        }
    });
}

export function bindMuted(media: HTMLMediaElement, signal: Signal<boolean>): void {
    listen(media, ['volumechange'], () => {
        set(signal, media.muted);
    }, get(signal) == null);

    effect(() => {
        const value = !!get(signal);
        if (media.muted !== value) media.muted = value;
    });
}

export function bindPlaybackRate(media: HTMLMediaElement, signal: Signal<number>): void {
    effect(() => {
        const value = get(signal);
        if (value !== media.playbackRate && !isNaN(value)) {
            media.playbackRate = value;
        }
    });

    effect(() => {
        listen(media, ['ratechange'], () => {
            set(signal, media.playbackRate);
        });
    });
}

// ── Readonly bindings ──────────────────────────────────────────────

export function bindDuration(media: HTMLMediaElement, signal: Signal): void {
    listen(media, ['loadedmetadata', 'durationchange'], () => set(signal, media.duration));
}

export function bindBuffered(media: HTMLMediaElement, signal: Signal): void {
    listen(media, ['loadedmetadata', 'progress', 'timeupdate', 'seeking'], () => {
        set(signal, timeRangesToArray(media.buffered));
    });
}

export function bindSeekable(media: HTMLMediaElement, signal: Signal): void {
    listen(media, ['loadedmetadata'], () => set(signal, timeRangesToArray(media.seekable)));
}

export function bindSeeking(media: HTMLMediaElement, signal: Signal<boolean>): void {
    listen(media, ['seeking', 'seeked'], () => set(signal, media.seeking));
}

export function bindEnded(media: HTMLMediaElement, signal: Signal<boolean>): void {
    listen(media, ['timeupdate', 'ended'], () => set(signal, media.ended));
}

export function bindReadyState(media: HTMLMediaElement, signal: Signal<number>): void {
    listen(media, ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'emptied'], () => {
        set(signal, media.readyState);
    });
}

export function bindPlayed(media: HTMLMediaElement, signal: Signal): void {
    listen(media, ['timeupdate'], () => set(signal, timeRangesToArray(media.played)));
}

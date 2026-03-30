import { effect } from '../reactivity/effect';
import { listen } from './shared';
import type { Getter, Setter } from './types';

// ── Two-way bindings ───────────────────────────────────────────────

function timeRangesToArray(ranges: TimeRanges): { start: number; end: number }[] {
    const arr: { start: number; end: number }[] = [];
    for (let i = 0; i < ranges.length; i++) {
        arr.push({ start: ranges.start(i), end: ranges.end(i) });
    }
    return arr;
}

export function bindCurrentTime(media: HTMLMediaElement, get: Getter<number>, set: Setter<number>): void {
    let raf: number;
    let value: number;

    const callback = () => {
        cancelAnimationFrame(raf);
        if (!media.paused) {
            raf = requestAnimationFrame(callback);
        }
        const next = media.currentTime;
        if (value !== next) {
            set((value = next));
        }
    };

    raf = requestAnimationFrame(callback);
    media.addEventListener('timeupdate', callback);

    effect(() => {
        const next = get();
        if (value !== next && !isNaN(next)) {
            media.currentTime = value = next;
        }
    });
}

export function bindPaused(media: HTMLMediaElement, get: Getter<boolean>, set: Setter<boolean>): void {
    let paused = get();

    listen(media, ['play', 'pause', 'canplay'], () => {
        if (paused !== media.paused) {
            set((paused = media.paused));
        }
    }, paused == null);

    effect(() => {
        if ((paused = !!get()) !== media.paused) {
            if (paused) {
                media.pause();
            } else {
                media.play().catch(() => { });
            }
        }
    });
}

export function bindVolume(media: HTMLMediaElement, get: Getter<number>, set: Setter<number>): void {
    listen(media, ['volumechange'], () => {
        set(media.volume);
    }, get() == null);

    effect(() => {
        const value = get();
        if (value !== media.volume && !isNaN(value)) {
            media.volume = value;
        }
    });
}

export function bindMuted(media: HTMLMediaElement, get: Getter<boolean>, set: Setter<boolean>): void {
    listen(media, ['volumechange'], () => {
        set(media.muted);
    }, get() == null);

    effect(() => {
        const value = !!get();
        if (media.muted !== value) media.muted = value;
    });
}

export function bindPlaybackRate(media: HTMLMediaElement, get: Getter<number>, set: Setter<number>): void {
    effect(() => {
        const value = get();
        if (value !== media.playbackRate && !isNaN(value)) {
            media.playbackRate = value;
        }
    });

    effect(() => {
        listen(media, ['ratechange'], () => {
            set(media.playbackRate);
        });
    });
}

// ── Readonly bindings ──────────────────────────────────────────────

export function bindDuration(media: HTMLMediaElement, _get: any, set: Setter): void {
    listen(media, ['loadedmetadata', 'durationchange'], () => set(media.duration));
}

export function bindBuffered(media: HTMLMediaElement, _get: any, set: Setter): void {
    listen(media, ['loadedmetadata', 'progress', 'timeupdate', 'seeking'], () => {
        set(timeRangesToArray(media.buffered));
    });
}

export function bindSeekable(media: HTMLMediaElement, _get: any, set: Setter): void {
    listen(media, ['loadedmetadata'], () => set(timeRangesToArray(media.seekable)));
}

export function bindSeeking(media: HTMLMediaElement, _get: any, set: Setter<boolean>): void {
    listen(media, ['seeking', 'seeked'], () => set(media.seeking));
}

export function bindEnded(media: HTMLMediaElement, _get: any, set: Setter<boolean>): void {
    listen(media, ['timeupdate', 'ended'], () => set(media.ended));
}

export function bindReadyState(media: HTMLMediaElement, _get: any, set: Setter<number>): void {
    listen(media, ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'emptied'], () => {
        set(media.readyState);
    });
}

export function bindPlayed(media: HTMLMediaElement, _get: any, set: Setter): void {
    listen(media, ['timeupdate'], () => set(timeRangesToArray(media.played)));
}

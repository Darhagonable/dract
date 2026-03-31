import { effect, teardown } from '../reactivity/effect';
import { listen } from './shared';

function timeRangesToArray(ranges: TimeRanges) {
    var array = [];

    for (var i = 0; i < ranges.length; i += 1) {
        array.push({ start: ranges.start(i), end: ranges.end(i) });
    }

    return array;
}

export function bindCurrentTime(media: HTMLMediaElement, get: () => number | undefined, set: (value: number) => void = get) {
    var rafId: number;
    var value: number;

    // Ideally, listening to timeupdate would be enough, but it fires too infrequently for the currentTime
    // binding, which is why we use a raf loop, too. We additionally still listen to timeupdate because
    // the user could be scrubbing through the video using the native controls when the media is paused.
    var callback = () => {
        cancelAnimationFrame(rafId);

        if (!media.paused) {
            rafId = requestAnimationFrame(callback);
        }

        var nextValue = media.currentTime;
        if (value !== nextValue) {
            set((value = nextValue));
        }
    };

    rafId = requestAnimationFrame(callback);
    media.addEventListener('timeupdate', callback);

    effect(() => {
        var nextValue = Number(get());

        if (value !== nextValue && !isNaN(nextValue)) {
            media.currentTime = value = nextValue;
        }
    });

    teardown(() => {
        cancelAnimationFrame(rafId);
        media.removeEventListener('timeupdate', callback);
    });
}

export function bindPlaybackRate(media: HTMLMediaElement, get: () => number | undefined, set: (playbackRate: number) => void = get) {
    // Needs to happen after element is inserted into the dom (which is guaranteed by using effect),
    // else playback will be set back to 1 by the browser
    effect(() => {
        var value = Number(get());

        if (value !== media.playbackRate && !isNaN(value)) {
            media.playbackRate = value;
        }
    });

    // Start listening to ratechange events after the element is inserted into the dom,
    // else playback will be set to 1 by the browser
    effect(() => {
        listen(media, ['ratechange'], () => {
            set(media.playbackRate);
        });
    });
}

export function bindPaused(media: HTMLMediaElement, get: () => boolean | undefined, set: (paused: boolean) => void = get) {
    var paused = get();

    var update = () => {
        if (paused !== media.paused) {
            set((paused = media.paused));
        }
    };

    // If someone switches the src while media is playing, the player will pause.
    // Listen to the canplay event to get notified of this situation.
    listen(media, ['play', 'pause', 'canplay'], update, paused == null);

    // Needs to be an effect to ensure media element is mounted: else, if paused is `false` (i.e. should play right away)
    // a "The play() request was interrupted by a new load request" error would be thrown because the resource isn't loaded yet.
    effect(() => {
        if ((paused = !!get()) !== media.paused) {
            if (paused) {
                media.pause();
            } else {
                media.play().catch((error) => {
                    set((paused = true));
                    throw error;
                });
            }
        }
    });
}

export function bindVolume(media: HTMLMediaElement, get: () => number | undefined, set: (volume: number) => void = get) {
    var callback = () => {
        set(media.volume);
    };

    if (get() == null) {
        callback();
    }

    listen(media, ['volumechange'], callback, false);

    effect(() => {
        var value = Number(get());

        if (value !== media.volume && !isNaN(value)) {
            media.volume = value;
        }
    });
}

export function bindMuted(media: HTMLMediaElement, get: () => boolean | undefined, set: (muted: boolean) => void = get) {
    var callback = () => {
        set(media.muted);
    };

    if (get() == null) {
        callback();
    }

    listen(media, ['volumechange'], callback, false);

    effect(() => {
        var value = !!get();

        if (media.muted !== value) media.muted = value;
    });
}

// ── Readonly bindings ──────────────────────────────────────────────

export function bindDuration(media: HTMLMediaElement, set: (duration: number) => void) {
    listen(media, ['loadedmetadata', 'durationchange'], () => set(media.duration));
}

export function bindBuffered(media: HTMLMediaElement, set: (array: Array<{ start: number; end: number }>) => void) {
    var current: { start: number; end: number; }[];

    // `buffered` can update without emitting any event, so we check it on various events.
    // By specs, `buffered` always returns a new object, so we have to compare deeply.
    listen(media, ['loadedmetadata', 'progress', 'timeupdate', 'seeking'], () => {
        var ranges = media.buffered;

        if (
            !current ||
            current.length !== ranges.length ||
            current.some((range, i) => ranges.start(i) !== range.start || ranges.end(i) !== range.end)
        ) {
            current = timeRangesToArray(ranges);
            set(current);
        }
    });
}

export function bindSeekable(media: HTMLMediaElement, set: (array: Array<{ start: number; end: number }>) => void) {
    listen(media, ['loadedmetadata'], () => set(timeRangesToArray(media.seekable)));
}

export function bindPlayed(media: HTMLMediaElement, set: (array: Array<{ start: number; end: number }>) => void) {
    listen(media, ['timeupdate'], () => set(timeRangesToArray(media.played)));
}

export function bindSeeking(media: HTMLMediaElement, set: (seeking: boolean) => void) {
    listen(media, ['seeking', 'seeked'], () => set(media.seeking));
}

export function bindEnded(media: HTMLMediaElement, set: (seeking: boolean) => void) {
    listen(media, ['timeupdate', 'ended'], () => set(media.ended));
}

export function bindReadyState(media: HTMLMediaElement, set: (readyState: number) => void) {
    listen(
        media,
        ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'emptied'],
        () => set(media.readyState)
    );
}
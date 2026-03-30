import { listen } from './shared';
import type { Setter } from './types';

export function bindVideoWidth(video: HTMLVideoElement, _get: any, set: Setter<number>): void {
    listen(video, ['loadedmetadata', 'resize'], () => set(video.videoWidth));
}

export function bindVideoHeight(video: HTMLVideoElement, _get: any, set: Setter<number>): void {
    listen(video, ['loadedmetadata', 'resize'], () => set(video.videoHeight));
}

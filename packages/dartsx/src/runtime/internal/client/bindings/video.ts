import { type Signal, set } from '../reactivity/state';
import { listen } from './shared';

export function bindVideoWidth(video: HTMLVideoElement, signal: Signal<number>): void {
    listen(video, ['loadedmetadata', 'resize'], () => set(signal, video.videoWidth));
}

export function bindVideoHeight(video: HTMLVideoElement, signal: Signal<number>): void {
    listen(video, ['loadedmetadata', 'resize'], () => set(signal, video.videoHeight));
}

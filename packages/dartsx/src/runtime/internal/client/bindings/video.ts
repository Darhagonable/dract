import { listen } from './shared';

export function bindVideoWidth(video: HTMLVideoElement, set: (width: number) => void) {
	listen(video, ['loadedmetadata', 'resize'], () => set(video.videoWidth));
}

export function bindVideoHeight(video: HTMLVideoElement, set: (height: number) => void) {
	listen(video, ['loadedmetadata', 'resize'], () => set(video.videoHeight));
}

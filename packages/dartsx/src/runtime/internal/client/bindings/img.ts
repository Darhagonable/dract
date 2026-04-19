import { listen } from './shared';

export function bindNaturalWidth(img: HTMLImageElement, set: (width: number) => void) {
	listen(img, ['load'], () => set(img.naturalWidth));
}

export function bindNaturalHeight(img: HTMLImageElement, set: (height: number) => void) {
	listen(img, ['load'], () => set(img.naturalHeight));
}

export function bindComplete(img: HTMLImageElement, set: (complete: boolean) => void) {
	listen(img, ['load', 'error'], () => set(img.complete));
}

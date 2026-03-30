import { listen } from './shared';
import type { Setter } from './types';

export function bindNaturalWidth(img: HTMLImageElement, _get: any, set: Setter<number>): void {
    listen(img, ['load'], () => set(img.naturalWidth));
}

export function bindNaturalHeight(img: HTMLImageElement, _get: any, set: Setter<number>): void {
    listen(img, ['load'], () => set(img.naturalHeight));
}

export function bindComplete(img: HTMLImageElement, _get: any, set: Setter<boolean>): void {
    listen(img, ['load', 'error'], () => set(img.complete));
}

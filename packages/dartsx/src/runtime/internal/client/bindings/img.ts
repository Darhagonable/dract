import { type Signal, set } from '../reactivity/state';
import { listen } from './shared';

export function bindNaturalWidth(img: HTMLImageElement, signal: Signal<number>): void {
    listen(img, ['load'], () => set(signal, img.naturalWidth));
}

export function bindNaturalHeight(img: HTMLImageElement, signal: Signal<number>): void {
    listen(img, ['load'], () => set(signal, img.naturalHeight));
}

export function bindComplete(img: HTMLImageElement, signal: Signal<boolean>): void {
    listen(img, ['load', 'error'], () => set(signal, img.complete));
}

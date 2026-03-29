import { bindValue, bindChecked, bindIndeterminate, bindGroup, bindFiles } from './input';
import { bindSelectValue } from './select';
import { bindThis } from './this';
import { bindOpen } from './details';
import {
    bindCurrentTime, bindPaused, bindVolume, bindMuted, bindPlaybackRate,
    bindDuration, bindBuffered, bindSeekable, bindSeeking, bindEnded,
    bindReadyState, bindPlayed,
} from './audio';
import { bindVideoWidth, bindVideoHeight } from './video';
import { bindNaturalWidth, bindNaturalHeight, bindComplete } from './img';
import { bindElementSize, bindResizeObserver } from './dimensions';
import { bindInnerHTML, bindInnerText, bindTextContent } from './props';

export function applyBinding(el: Element, prop: string, value: any): void {
    // bind:this — works on any Element
    if (prop === 'this') return bindThis(el, value);

    // Select bindings
    if (el instanceof HTMLSelectElement) {
        if (prop === 'value') return bindSelectValue(el, value);
    }

    // Input bindings
    if (el instanceof HTMLInputElement) {
        switch (prop) {
            case 'value': return bindValue(el, value);
            case 'checked': return bindChecked(el, value);
            case 'indeterminate': return bindIndeterminate(el, value);
            case 'group': return bindGroup(el, value);
            case 'files': return bindFiles(el, value);
        }
    }

    // Textarea bindings
    if (el instanceof HTMLTextAreaElement) {
        if (prop === 'value') return bindValue(el, value);
    }

    // Details
    if (el instanceof HTMLDetailsElement) {
        if (prop === 'open') return bindOpen(el, value);
    }

    // Media bindings (audio/video)
    if (el instanceof HTMLMediaElement) {
        switch (prop) {
            case 'currentTime': return bindCurrentTime(el, value);
            case 'paused': return bindPaused(el, value);
            case 'volume': return bindVolume(el, value);
            case 'muted': return bindMuted(el, value);
            case 'playbackRate': return bindPlaybackRate(el, value);
            case 'duration': return bindDuration(el, value);
            case 'buffered': return bindBuffered(el, value);
            case 'seekable': return bindSeekable(el, value);
            case 'seeking': return bindSeeking(el, value);
            case 'ended': return bindEnded(el, value);
            case 'readyState': return bindReadyState(el, value);
            case 'played': return bindPlayed(el, value);
        }
        if (el instanceof HTMLVideoElement) {
            switch (prop) {
                case 'videoWidth': return bindVideoWidth(el, value);
                case 'videoHeight': return bindVideoHeight(el, value);
            }
        }
    }

    // Image bindings
    if (el instanceof HTMLImageElement) {
        switch (prop) {
            case 'naturalWidth': return bindNaturalWidth(el, value);
            case 'naturalHeight': return bindNaturalHeight(el, value);
            case 'complete': return bindComplete(el, value);
        }
    }

    // Contenteditable bindings
    if (el instanceof HTMLElement && el.isContentEditable) {
        switch (prop) {
            case 'innerHTML': return bindInnerHTML(el, value);
            case 'innerText': return bindInnerText(el, value);
            case 'textContent': return bindTextContent(el, value);
        }
    }

    // Dimension bindings (any visible element)
    switch (prop) {
        case 'clientWidth': case 'clientHeight':
        case 'scrollWidth': case 'scrollHeight':
        case 'offsetWidth': case 'offsetHeight':
            return bindElementSize(el, prop, value);
        case 'contentRect': case 'contentBoxSize':
        case 'borderBoxSize': case 'devicePixelContentBoxSize':
            return bindResizeObserver(el, prop, value);
    }
}

import { bindValue, bindChecked, bindIndeterminate, bindGroup, bindFiles } from './input';
import { bindSelectValue } from './select';
import { bindThis } from './this';
import { bindOpen } from './details';
import {
	bindCurrentTime, bindPaused, bindVolume, bindMuted, bindPlaybackRate,
	bindDuration, bindBuffered, bindSeekable, bindSeeking, bindEnded,
	bindReadyState, bindPlayed,
} from './media';
import { bindVideoWidth, bindVideoHeight } from './video';
import { bindNaturalWidth, bindNaturalHeight, bindComplete } from './img';
import { bindElementSize, bindResizeObserver } from './dimensions';
import { bindInnerHTML, bindInnerText, bindTextContent } from './props';
import type { BindTuple } from './types';

export function applyBinding(el: Element, prop: string, value: BindTuple): void {
	const [get, set] = value;

	// bind:this — works on any Element
	if (prop === 'this') return bindThis(el, set);

	// Select bindings
	if (el instanceof HTMLSelectElement) {
		if (prop === 'value') return bindSelectValue(el, get, set);
	}

	// Input bindings
	if (el instanceof HTMLInputElement) {
		switch (prop) {
			case 'value': return bindValue(el, get, set);
			case 'checked': return bindChecked(el, get, set);
			case 'indeterminate': return bindIndeterminate(el, get, set);
			case 'group': return bindGroup(el, get, set);
			case 'files': return bindFiles(el, get, set);
		}
	}

	// Textarea bindings
	if (el instanceof HTMLTextAreaElement) {
		if (prop === 'value') return bindValue(el, get, set);
	}

	// Details
	if (el instanceof HTMLDetailsElement) {
		if (prop === 'open') return bindOpen(el, get, set);
	}

	// Media bindings (audio/video)
	if (el instanceof HTMLMediaElement) {
		switch (prop) {
			case 'currentTime': return bindCurrentTime(el, get, set);
			case 'paused': return bindPaused(el, get, set);
			case 'volume': return bindVolume(el, get, set);
			case 'muted': return bindMuted(el, get, set);
			case 'playbackRate': return bindPlaybackRate(el, get, set);
			case 'duration': return bindDuration(el, set);
			case 'buffered': return bindBuffered(el, set);
			case 'seekable': return bindSeekable(el, set);
			case 'seeking': return bindSeeking(el, set);
			case 'ended': return bindEnded(el, set);
			case 'readyState': return bindReadyState(el, set);
			case 'played': return bindPlayed(el, set);
		}
		if (el instanceof HTMLVideoElement) {
			switch (prop) {
				case 'videoWidth': return bindVideoWidth(el, set);
				case 'videoHeight': return bindVideoHeight(el, set);
			}
		}
	}

	// Image bindings
	if (el instanceof HTMLImageElement) {
		switch (prop) {
			case 'naturalWidth': return bindNaturalWidth(el, set);
			case 'naturalHeight': return bindNaturalHeight(el, set);
			case 'complete': return bindComplete(el, set);
		}
	}

	// Contenteditable bindings
	if (el instanceof HTMLElement && el.isContentEditable) {
		switch (prop) {
			case 'innerHTML': return bindInnerHTML(el, get, set);
			case 'innerText': return bindInnerText(el, get, set);
			case 'textContent': return bindTextContent(el, get, set);
		}
	}

	// Dimension bindings (any visible element)
	if (el instanceof HTMLElement) {
		switch (prop) {
			case 'clientWidth': case 'clientHeight':
			case 'scrollWidth': case 'scrollHeight':
			case 'offsetWidth': case 'offsetHeight':
				return bindElementSize(el, prop, set);
		}
	}

	switch (prop) {
		case 'contentRect': case 'contentBoxSize':
		case 'borderBoxSize': case 'devicePixelContentBoxSize':
			return bindResizeObserver(el, prop, set);
	}
}

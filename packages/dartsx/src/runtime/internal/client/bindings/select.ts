import { effect } from '../reactivity/effect';
import { teardown } from '../reactivity/effect';

/** Read the real value from an option — uses __value if set (for non-string values) */
function getOptionValue(option: HTMLOptionElement): unknown {
	return '__value' in option ? option.__value : option.value;
}

/** Set the selected options to match `value` */
function selectOption(select: HTMLSelectElement, value: unknown, mounting = false): void {
	if (select.multiple) {
		if (value == null) return;
		const arr = Array.isArray(value) ? value : [];
		for (const opt of select.options) {
			opt.selected = arr.includes(getOptionValue(opt));
		}
		return;
	}

	for (const opt of select.options) {
		if (Object.is(getOptionValue(opt), value)) {
			opt.selected = true;
			return;
		}
	}

	// No match — deselect all (unless mounting with undefined value)
	if (!mounting || value !== undefined) {
		select.selectedIndex = -1;
	}
}

export function bindSelectValue(select: HTMLSelectElement, get: () => unknown, set: (value: unknown) => void) {
	let mounting = true;

	// Listen for user changes and form resets
	select.addEventListener('change', () => {
		let value: unknown;

		if (select.multiple) {
			value = Array.from(select.selectedOptions, getOptionValue);
		} else {
			const opt = select.selectedOptions[0];
			value = opt ? getOptionValue(opt) : undefined;
		}

		set(value);
	});

	// Handle form reset — revert to `selected` attribute state
	const form = select.closest('form');
	if (form) {
		form.addEventListener('reset', () => {
			// After reset, the DOM reverts to `selected` attributes.
			// We need to read the new DOM state and push it to the binding.
			requestAnimationFrame(() => {
				let value: unknown;
				if (select.multiple) {
					value = Array.from(
						select.querySelectorAll<HTMLOptionElement>('[selected]'),
						getOptionValue,
					);
				} else {
					const opt = select.querySelector<HTMLOptionElement>('[selected]') ??
						select.querySelector<HTMLOptionElement>('option:not([disabled])');
					value = opt ? getOptionValue(opt) : undefined;
				}
				set(value);
			});
		});
	}

	// Sync state → DOM
	effect(() => {
		const value = get();
		selectOption(select, value, mounting);

		// On mount with undefined value, read the initial DOM selection
		if (mounting && value === undefined) {
			const opt = select.querySelector<HTMLOptionElement>(':checked');
			if (opt) {
				set(getOptionValue(opt));
			}
		}

		mounting = false;
	});

	// Watch for dynamic option changes (e.g. options inside a for block)
	const observer = new MutationObserver(() => {
		selectOption(select, get());
	});

	observer.observe(select, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['value'],
	});

	teardown(() => observer.disconnect());
}

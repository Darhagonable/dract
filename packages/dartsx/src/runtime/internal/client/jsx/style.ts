// ── Style object application (React-compatible) ───────────────────

/**
 * CSS properties which accept numbers but are not in units of "px".
 */
const unitlessNumbers = new Set([
	'animationIterationCount',
	'aspectRatio',
	'borderImageOutset',
	'borderImageSlice',
	'borderImageWidth',
	'boxFlex',
	'boxFlexGroup',
	'boxOrdinalGroup',
	'columnCount',
	'columns',
	'flex',
	'flexGrow',
	'flexPositive',
	'flexShrink',
	'flexNegative',
	'flexOrder',
	'gridArea',
	'gridRow',
	'gridRowEnd',
	'gridRowSpan',
	'gridRowStart',
	'gridColumn',
	'gridColumnEnd',
	'gridColumnSpan',
	'gridColumnStart',
	'fontWeight',
	'lineClamp',
	'lineHeight',
	'opacity',
	'order',
	'orphans',
	'scale',
	'tabSize',
	'widows',
	'zIndex',
	'zoom',
	'fillOpacity', // SVG-related properties
	'floodOpacity',
	'stopOpacity',
	'strokeDasharray',
	'strokeDashoffset',
	'strokeMiterlimit',
	'strokeOpacity',
	'strokeWidth',
	'MozAnimationIterationCount', // Known Prefixed Properties
	'MozBoxFlex', // TODO: Remove these since they shouldn't be used in modern code
	'MozBoxFlexGroup',
	'MozLineClamp',
	'msAnimationIterationCount',
	'msFlex',
	'msZoom',
	'msFlexGrow',
	'msFlexNegative',
	'msFlexOrder',
	'msFlexPositive',
	'msFlexShrink',
	'msGridColumn',
	'msGridColumnSpan',
	'msGridRow',
	'msGridRowSpan',
	'WebkitAnimationIterationCount',
	'WebkitBoxFlex',
	'WebKitBoxFlexGroup',
	'WebkitBoxOrdinalGroup',
	'WebkitColumnCount',
	'WebkitColumns',
	'WebkitFlex',
	'WebkitFlexGrow',
	'WebkitFlexPositive',
	'WebkitFlexShrink',
	'WebkitLineClamp',
]);

function setValueForStyle(style: CSSStyleDeclaration, name: string, value: any): void {
	const isCustomProperty = name.indexOf('--') === 0;

	if (value == null || typeof value === 'boolean' || value === '') {
		if (isCustomProperty) {
			style.setProperty(name, '');
		} else if (name === 'float') {
			style.cssFloat = '';
		} else {
			style[name as any] = '';
		}
	} else if (isCustomProperty) {
		style.setProperty(name, value);
	} else if (typeof value === 'number' && value !== 0 && !unitlessNumbers.has(name)) {
		style[name as any] = value + 'px';
	} else {
		if (name === 'float') {
			style.cssFloat = value;
		} else {
			style[name as any] = ('' + value).trim();
		}
	}
}

export function setValueForStyles(
	node: HTMLElement,
	styles: Record<string, any>,
	prevStyles?: Record<string, any> | null,
): void {
	const style = node.style;

	if (prevStyles != null) {
		// Clear properties that were in prev but not in next
		for (const styleName in prevStyles) {
			if (
				prevStyles.hasOwnProperty(styleName) &&
				(styles == null || !styles.hasOwnProperty(styleName))
			) {
				const isCustomProperty = styleName.indexOf('--') === 0;
				if (isCustomProperty) {
					style.setProperty(styleName, '');
				} else if (styleName === 'float') {
					style.cssFloat = '';
				} else {
					style[styleName as any] = '';
				}
			}
		}
		// Update only changed properties
		for (const styleName in styles) {
			if (styles.hasOwnProperty(styleName) && prevStyles[styleName] !== styles[styleName]) {
				setValueForStyle(style, styleName, styles[styleName]);
			}
		}
	} else {
		for (const styleName in styles) {
			if (styles.hasOwnProperty(styleName)) {
				setValueForStyle(style, styleName, styles[styleName]);
			}
		}
	}
}

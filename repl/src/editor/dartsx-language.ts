import type { languages } from 'monaco-editor';

export const dartsxMonarchLanguage: languages.IMonarchLanguage = {
	defaultToken: '',
	tokenPostfix: '.dartsx',

	keywords: [
		'component', 'state', 'derived', 'render', 'export', 'default',
		'async', 'function', 'return', 'import', 'from', 'as',
		'if', 'else', 'for', 'switch', 'case', 'default', 'break',
		'try', 'catch', 'pending', 'while', 'true', 'false', 'null',
		'undefined', 'const', 'let', 'var', 'new', 'this', 'class',
		'typeof', 'instanceof', 'void', 'delete', 'in', 'of',
	],

	typeKeywords: [
		'string', 'number', 'boolean', 'any', 'void', 'never',
		'undefined', 'null', 'unknown', 'bigint', 'symbol',
		'object', 'Record', 'Partial', 'Required', 'Pick', 'Omit',
		'Promise', 'Array', 'Map', 'Set', 'Component',
	],

	controlFlow: ['if', 'for', 'switch', 'try'],

	brackets: [
		{ open: '{', close: '}', token: 'delimiter.curly' },
		{ open: '[', close: ']', token: 'delimiter.square' },
		{ open: '(', close: ')', token: 'delimiter.parenthesis' },
		{ open: '<', close: '>', token: 'delimiter.angle' },
	],

	tokenizer: {
		root: [
			[/@?[a-zA-Z_$][\w$]*/, {
				cases: {
					'@keywords': 'keyword',
					'@typeKeywords': 'type',
					'@default': 'identifier',
				},
			}],

			[/\/\/.*$/, 'comment'],
			[/\/\*/, 'comment', '@comment'],

			[/'[^']*'/, 'string'],
			[/"[^"]*"/, 'string'],
			[/`/, 'string', '@backtick'],

			[/\d+\.?\d*/, 'number'],

			[/[{}\[\]()]/, '@brackets'],
			[/[;,.:]/, 'delimiter'],

			[/\s+/, 'white'],

			[/\$\.[a-zA-Z_]\w*/, 'function'],

			[/<style(\s+global)?>/, 'tag', '@css'],
			[/<\/style>/, 'tag'],

			[/\{@@html\s+/, 'keyword', '@html'],

			[/\bbind:[a-zA-Z_][\w-]*/, 'attribute'],

			[/<\/?[A-Za-z_][\w.]*(?:\s|>|\/>)/, 'tag'],
			[/\/?>/, 'tag'],
		],

		comment: [
			[/[^/*]+/, 'comment'],
			[/\*\//, 'comment', '@pop'],
			[/[/*]/, 'comment'],
		],

		backtick: [
			[/\\`/, 'string'],
			[/\$/, 'string'],
			[/`/, 'string', '@pop'],
			[/[^`\\$]+/, 'string'],
		],

		css: [
			[/<\/style>/, { token: 'tag', next: '@pop' }],
			[/[^<]+/, 'css'],
			[/./, 'css'],
		],

		html: [
			[/\}/, 'keyword', '@pop'],
			[/[^}]+/, 'identifier'],
		],
	},
};

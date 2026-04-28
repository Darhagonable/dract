const { defineConfig } = require('@vscode/test-cli');
const path = require('path');

module.exports = defineConfig([{
	label: 'e2e',
	files: 'dist/test/*.test.js',
	extensionDevelopmentPath: __dirname,
	workspaceFolder: path.resolve(__dirname, 'test/fixture'),
	version: 'stable',
	launchArgs: ['--disable-extensions', '--disable-gpu'],
	mocha: {
		ui: 'tdd',
		timeout: 30000,
	},
}]);

import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { create as createHtmlService } from 'volar-service-html';
import { getDarTsxLanguagePlugin } from '@dartsx/language-service';
import * as fs from 'fs';

// the language core is Node-free — host it with a disk-backed reader
function readFile(fileName: string): string | undefined {
	try {
		return fs.readFileSync(fileName, 'utf-8');
	} catch {
		return undefined;
	}
}

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
	return server.initialize(
		params,
		createSimpleProject([getDarTsxLanguagePlugin(readFile)]),
		[createCssService(), createHtmlService()],
	);
});

connection.onInitialized(server.initialized);
connection.listen();

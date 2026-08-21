import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { create as createHtmlService } from 'volar-service-html';
import { getDarTsxLanguagePlugin } from '@dartsx/language';
import * as fs from 'fs';

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
	return server.initialize(
		params,
		createSimpleProject([getDarTsxLanguagePlugin({ readFileSync: (filePath) => fs.readFileSync(filePath, 'utf-8') })]),
		[createCssService(), createHtmlService()],
	);
});

connection.onInitialized(server.initialized);
connection.listen();
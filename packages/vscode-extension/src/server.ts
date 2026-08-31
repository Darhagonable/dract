import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { create as createHtmlService } from 'volar-service-html';
import { getDarTsxLanguagePlugin } from '@dartsx/language-service';

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
	return server.initialize(
		params,
		createSimpleProject([getDarTsxLanguagePlugin()]),
		[createCssService(), createHtmlService()],
	);
});

connection.onInitialized(server.initialized);
connection.listen();

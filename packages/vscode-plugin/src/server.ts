import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { getDarTsxLanguagePlugin } from 'dartsx-typescript-plugin/dist/language';

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
	return server.initialize(
		params,
		createSimpleProject([getDarTsxLanguagePlugin()]),
		[createCssService()],
	);
});

connection.onInitialized(server.initialized);
connection.listen();

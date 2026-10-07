import { createServer, listen } from './src/server.js';
import { configureStore } from './src/store.js';

const dataDir = process.env.DATA_DIR || './data';
await configureStore(dataDir, { reset: process.env.RESET_DATA === '1' });
const server = createServer();
await listen(server);
console.log(`运河船工故事站 listening on http://localhost:${server.address().port} (data: ${dataDir})`);

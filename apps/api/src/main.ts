import { loadConfig, setConfig } from './config.js';
import { buildServer } from './server.js';
import { projectId } from './firebase.js';

let config;
try {
  config = loadConfig();
  setConfig(config);
} catch (err) {
  console.error(`[FATAL CONFIG ERROR] ${(err as Error).message}`);
  process.exit(1);
}

const app = await buildServer({ logger: true, config });
await app.listen({ port: config.port, host: config.host });
app.log.info({ projectId: projectId() }, 'DeviceNet API ready');

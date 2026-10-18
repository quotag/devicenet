import { buildServer } from './server.js';
import { projectId } from './firebase.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildServer({ logger: true });
await app.listen({ port, host });
app.log.info({ projectId: projectId() }, 'DeviceNet API ready');

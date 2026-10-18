import { startDevCloudBroker, version } from './index.js';

const env = process.env;
const apiUrl = env.DEV_API_URL ?? 'http://127.0.0.1:3000';
const broker = await startDevCloudBroker({
  tcpPort: Number(env.DEV_BROKER_TCP_PORT ?? 1884),
  wsPort: Number(env.DEV_BROKER_WS_PORT ?? 8084),
  webhookUrl: env.DEV_WEBHOOK_URL ?? `${apiUrl}/v1/emqx/webhook`,
  token: env.EMQX_SHARED_TOKEN ?? 'dev-token',
  log: (m) => console.warn('[dev-cloud-broker]', m),
});
console.log(`DeviceNet Dev Cloud Broker v${version}: tcp ${broker.tcpPort}, ws ${broker.wsPort}`);
const stop = () => void broker.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

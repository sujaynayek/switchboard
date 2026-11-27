import express from 'express';
import { config } from './config/env.js';
import { checkStores, mongo, redis } from './config/stores.js';
import { currentGeneration, initializeModels } from './models/inbox.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { graderRouter } from './routes/grader.js';
import { webhookRouter } from './routes/webhooks.js';
import { advanceEventGeneration } from './services/event-stream.js';
import { attachWebSockets } from './services/websocket.js';
import { startDeliveryWorker } from './workers/delivery.js';
import { startEventPublisher } from './workers/events.js';

try {
  await Promise.all([mongo.connect(), redis.connect()]);
  await initializeModels();
  await advanceEventGeneration(await currentGeneration());
} catch (error) {
  console.error('Startup failed:', error.message);
  redis.disconnect();
  await mongo.close();
  process.exit(1);
}

const controller = new AbortController();
const app = express();
app.disable('x-powered-by');
app.get('/healthz', async (req, res) => {
  if (controller.signal.aborted) return res.sendStatus(503);
  try {
    await checkStores();
    res.sendStatus(200);
  } catch {
    res.sendStatus(503);
  }
});
app.use('/webhooks', webhookRouter);
app.use('/__grader', graderRouter);
app.use('/auth', authRouter);
app.use('/api', apiRouter);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status >= 400 && error.status < 500) return res.sendStatus(error.status);
  console.error('Request failed:', error.message);
  res.sendStatus(503);
});

const workers = Promise.all([startDeliveryWorker(controller.signal), startEventPublisher(controller.signal)]);
const server = app.listen(config.port, () => console.log('Switchboard listening on ' + server.address().port));
const closeSockets = attachWebSockets(server);
server.requestTimeout = 10000;

function shutdown() {
  controller.abort();
  closeSockets();
  server.close(async () => {
    await workers;
    redis.disconnect();
    await mongo.close();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

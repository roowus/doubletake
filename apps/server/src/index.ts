import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './api/server.js';
import { createBrain } from './brains/registry.js';
import { loadConfig } from './config/index.js';
import { openDb } from './db/index.js';
import { Repo } from './db/repo.js';
import { MediaWorkerClient } from './media/worker-client.js';
import { createHub } from './notify/index.js';
import { QueueWorker } from './queue/worker.js';

export { buildServer } from './api/server.js';
export { loadConfig } from './config/index.js';
export { openDb } from './db/index.js';
export { Repo } from './db/repo.js';
export { QueueWorker } from './queue/worker.js';

export async function main(): Promise<void> {
  const cfg = loadConfig();
  for (const d of [
    cfg.dataDir,
    path.join(cfg.dataDir, 'logs'),
    path.join(cfg.dataDir, 'agent-cwd'),
    cfg.notesDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const { db, sqlite, close } = openDb(path.join(cfg.dataDir, 'doubletake.db'));
  const repo = new Repo(db, sqlite);
  const brain = createBrain(cfg);
  const worker = new QueueWorker(repo, brain, cfg);
  const { hub, vapid } = createHub(cfg, repo);
  worker.notifier = hub;
  const app = await buildServer({ cfg, repo, worker, brain, hub, vapidPublicKey: vapid.publicKey });
  const media = cfg.media.enabled ? new MediaWorkerClient(cfg, app.log) : null;
  worker.media = media;
  if (media) {
    void media.ping().then((ok) => {
      if (!ok) app.log.warn('media worker did not answer ping; check logs/worker.log');
    });
  }

  worker.start();
  await app.listen({ host: cfg.bind, port: cfg.port });
  app.log.info(
    `Doubletake listening on http://${cfg.bind}:${cfg.port} (brain: ${brain.id}, push: ${hub.kinds().join('+') || 'none'}, media: ${media ? `${cfg.media.command.join(' ')} vision=${cfg.media.vision}` : 'off'}, data: ${cfg.dataDir})`,
  );

  const shutdown = async () => {
    app.log.info('shutting down');
    await worker.stop();
    await media?.stop();
    await app.close();
    close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

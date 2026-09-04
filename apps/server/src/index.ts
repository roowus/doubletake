import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './api/server.js';
import { BrainSet } from './brains/registry.js';
import { IgGraphClient } from './channels/instagram/graph.js';
import { InstagramChannel } from './channels/instagram/index.js';
import { loadConfig } from './config/index.js';
import { openDb } from './db/index.js';
import { Repo } from './db/repo.js';
import { Geocoder } from './geo/index.js';
import { MediaWorkerClient } from './media/worker-client.js';
import { createHub } from './notify/index.js';
import { DigestGate } from './notify/quiet.js';
import { QueueWorker } from './queue/worker.js';
import { SecretBox } from './secrets/box.js';

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
  const brains = BrainSet.fromConfig(cfg);
  const brain = brains.defaultBrain;
  const worker = new QueueWorker(repo, brains, cfg);
  const { hub, vapid } = createHub(cfg, repo);
  // Quiet hours: park run notifications and send one digest when the window ends (ADR 0020).
  const digest = new DigestGate(repo, hub, cfg.publicUrl ?? null);
  worker.notifier = digest;
  digest.start();
  digest.flush().catch((e) => console.warn('digest flush failed', e));
  // Instagram channel: routes exist whenever the Meta app credentials are configured.
  let ig: InstagramChannel | undefined;
  if (cfg.ig.appId && cfg.ig.appSecret) {
    ig = new InstagramChannel({
      cfg,
      repo,
      graph: new IgGraphClient(cfg.ig.graphBase, cfg.ig.appId, cfg.ig.appSecret),
      box: SecretBox.open(cfg.dataDir),
      adapterFor: (m) => brains.forMode(m),
      log: console,
    });
    worker.onOutcome = (item, outcome) => ig?.onOutcome(item, outcome) ?? Promise.resolve();
    worker.mediaHints = (item) => ig?.mediaHints(item) ?? {};
  }
  // Map view: place entities get coordinates from a Nominatim-compatible geocoder (ADR 0022).
  const geocoder = new Geocoder(cfg.geocoder, repo, { log: console });
  if (geocoder.enabled) worker.locatePlaces = (itemId) => geocoder.locateItem(itemId);
  const app = await buildServer({
    cfg,
    repo,
    worker,
    brain,
    hub,
    digest,
    vapidPublicKey: vapid.publicKey,
    ...(ig ? { ig } : {}),
    geocoder,
  });
  const media = cfg.media.enabled ? new MediaWorkerClient(cfg, app.log) : null;
  worker.media = media;
  if (media) {
    void media.ping().then((ok) => {
      if (!ok) app.log.warn('media worker did not answer ping; check logs/worker.log');
    });
  }

  worker.start();
  ig?.start();
  await app.listen({ host: cfg.bind, port: cfg.port });
  const igState = ig ? (ig.status().connected ? 'connected' : 'not connected') : 'off';
  app.log.info(
    `Doubletake listening on http://${cfg.bind}:${cfg.port} (brain: ${brains
      .all()
      .map((b) => b.id)
      .join(
        '+',
      )}, push: ${hub.kinds().join('+') || 'none'}, media: ${media ? `${cfg.media.command.join(' ')} vision=${cfg.media.vision}` : 'off'}, instagram: ${igState}, data: ${cfg.dataDir})`,
  );

  const shutdown = async () => {
    app.log.info('shutting down');
    ig?.stop();
    digest.stop();
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

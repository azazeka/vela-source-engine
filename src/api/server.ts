import cors from 'cors';
import express, { Express } from 'express';
import { MockTorrentProvider } from '../providers/mock-provider';
import { SourceEngine } from '../services/source-engine';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { createRouter } from './routes';

export function createApp(): { app: Express; sourceEngine: SourceEngine; torboxAdapter: TorBoxAdapter } {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const torboxAdapter = new TorBoxAdapter();
  const sourceEngine = new SourceEngine(torboxAdapter);

  // Register built-in / default providers
  sourceEngine.registerProvider(new MockTorrentProvider());

  const router = createRouter(sourceEngine, torboxAdapter);
  app.use('/api', router);
  app.use('/', router); // Also serve directly at root for convenience

  return { app, sourceEngine, torboxAdapter };
}

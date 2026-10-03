import cors from 'cors';
import express, { Express } from 'express';
import { TorBoxLibraryProvider } from '../providers/torbox-library-provider';
import { createConfiguredTorznabProviders } from '../providers/torznab-provider';
import { TorrentProvider } from '../providers/provider.interface';
import { SourceEngine } from '../services/source-engine';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { createRouter } from './routes';

export function createApp(options: { torboxAdapter?: TorBoxAdapter; providers?: TorrentProvider[] } = {}): { app: Express; sourceEngine: SourceEngine; torboxAdapter: TorBoxAdapter } {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const torboxAdapter = options.torboxAdapter ?? new TorBoxAdapter();
  const sourceEngine = new SourceEngine(torboxAdapter);

  // Register built-in / default providers
  const defaultProviders: TorrentProvider[] = [new TorBoxLibraryProvider(torboxAdapter)];
  defaultProviders.push(...createConfiguredTorznabProviders());
  for (const provider of options.providers ?? defaultProviders) {
    sourceEngine.registerProvider(provider);
  }

  const router = createRouter(sourceEngine, torboxAdapter);
  app.use('/api', router);
  app.use('/', router); // Also serve directly at root for convenience

  return { app, sourceEngine, torboxAdapter };
}

import cors from 'cors';
import express, { Express } from 'express';
import { PornolabProvider } from '../providers/pornolab-provider';
import { RutorProvider } from '../providers/rutor-provider';
import { TgxAdultProvider } from '../providers/tgx-adult-provider';
import { TpbAdultProvider } from '../providers/tpb-adult-provider';
import { TorBoxLibraryProvider } from '../providers/torbox-library-provider';
import { createConfiguredTorznabProviders } from '../providers/torznab-provider';
import { YtsProvider } from '../providers/yts-provider';
import { TorrentProvider } from '../providers/provider.interface';
import { AIService } from '../services/ai-service';
import { SourceEngine } from '../services/source-engine';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { createRouter } from './routes';

export function createApp(options: { torboxAdapter?: TorBoxAdapter; providers?: TorrentProvider[]; aiService?: AIService } = {}): { app: Express; sourceEngine: SourceEngine; torboxAdapter: TorBoxAdapter; aiService: AIService } {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const torboxAdapter = options.torboxAdapter ?? new TorBoxAdapter();
  const sourceEngine = new SourceEngine(torboxAdapter);
  const aiService = options.aiService ?? new AIService();

  // Register built-in / default providers
  const defaultProviders: TorrentProvider[] = [
    ...createConfiguredTorznabProviders(),
    new TorBoxLibraryProvider(torboxAdapter),
    new RutorProvider(),
    new YtsProvider(),
    new TgxAdultProvider(),
    new PornolabProvider(),
    new TpbAdultProvider(),
  ];
  for (const provider of options.providers ?? defaultProviders) {
    sourceEngine.registerProvider(provider);
  }

  const router = createRouter(sourceEngine, torboxAdapter, aiService);
  app.use('/api', router);
  app.use('/', router); // Also serve directly at root for convenience

  return { app, sourceEngine, torboxAdapter, aiService };
}

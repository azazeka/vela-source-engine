import cors from 'cors';
import express, { Express } from 'express';
import { BitsearchProvider } from '../providers/bitsearch-provider';
import { EztvProvider } from '../providers/eztv-provider';
import { NyaaProvider } from '../providers/nyaa-provider';
import { RutorProvider } from '../providers/rutor-provider';
import { TgxProvider } from '../providers/tgx-provider';
import { TpbProvider } from '../providers/tpb-provider';
import { TorBoxLibraryProvider } from '../providers/torbox-library-provider';
import { RealDebridLibraryProvider } from '../providers/realdebrid-library-provider';
import { createConfiguredTorznabProviders } from '../providers/torznab-provider';
import { TorrentioProvider } from '../providers/torrentio-provider';
import { YtsProvider } from '../providers/yts-provider';
import { TorrentProvider } from '../providers/provider.interface';
import { AIService } from '../services/ai-service';
import { SourceEngine } from '../services/source-engine';
import { RealDebridAdapter } from '../services/realdebrid-adapter';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { TrailerResolver } from '../services/trailer-resolver';
import { createRouter } from './routes';

export function createApp(options: {
  torboxAdapter?: TorBoxAdapter;
  realdebridAdapter?: RealDebridAdapter;
  providers?: TorrentProvider[];
  aiService?: AIService;
  trailerResolver?: TrailerResolver;
} = {}): {
  app: Express;
  sourceEngine: SourceEngine;
  torboxAdapter: TorBoxAdapter;
  realdebridAdapter: RealDebridAdapter;
  aiService: AIService;
  trailerResolver: TrailerResolver;
} {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const torboxAdapter = options.torboxAdapter ?? new TorBoxAdapter();
  const realdebridAdapter = options.realdebridAdapter ?? new RealDebridAdapter();
  const sourceEngine = new SourceEngine(torboxAdapter, realdebridAdapter);
  const aiService = options.aiService ?? new AIService();
  const trailerResolver = options.trailerResolver ?? new TrailerResolver();

  // Register built-in / default providers
  const defaultProviders: TorrentProvider[] = [
    ...createConfiguredTorznabProviders(),
    new RealDebridLibraryProvider(realdebridAdapter),
    new TorBoxLibraryProvider(torboxAdapter),
    new TorrentioProvider(),
    new RutorProvider(),
    new YtsProvider(),
    new TgxProvider(),
    new EztvProvider(),
    new TpbProvider(),
    new BitsearchProvider(),
    new NyaaProvider(),
  ];
  for (const provider of options.providers ?? defaultProviders) {
    sourceEngine.registerProvider(provider);
  }

  const router = createRouter(sourceEngine, torboxAdapter, aiService, trailerResolver, realdebridAdapter);
  app.use('/api', router);
  app.use('/', router); // Also serve directly at root for convenience

  return { app, sourceEngine, torboxAdapter, realdebridAdapter, aiService, trailerResolver };
}

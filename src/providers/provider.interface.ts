import { MediaRequest, ProviderHealth, RawRelease } from '../types';

export interface TorrentProvider {
  readonly id: string;
  readonly name: string;
  search(request: MediaRequest, apiKey?: string): Promise<RawRelease[]>;
  health(apiKey?: string): Promise<ProviderHealth>;
}

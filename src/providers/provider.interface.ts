import { MediaRequest, ProviderHealth, RawRelease } from '../types';

export interface TorrentProvider {
  readonly id: string;
  readonly name: string;
  search(request: MediaRequest): Promise<RawRelease[]>;
  health(): Promise<ProviderHealth>;
}

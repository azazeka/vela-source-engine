import { Container, CosmosClient } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
import { TasteProfile, TasteProfileStore, validateTasteProfile } from './taste-profile-store';

export interface TasteProfileRepository {
  load(scope: string): Promise<TasteProfile | null>;
  save(scope: string, profile: TasteProfile): Promise<TasteProfile>;
}
interface ProfileDocument { id: string; accountScope: string; profile: TasteProfile; _etag?: string }

export class CosmosTasteProfileStore implements TasteProfileRepository {
  constructor(private container: Container) {}
  private assertScope(scope: string) {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid profile scope');
  }
  async load(scope: string): Promise<TasteProfile | null> {
    this.assertScope(scope);
    try {
      const { resource } = await this.container.item(scope, scope).read<ProfileDocument>();
      return resource ? validateTasteProfile(resource.profile) : null;
    } catch (error: any) { if (error.code === 404) return null; throw error; }
  }
  async save(scope: string, profile: TasteProfile): Promise<TasteProfile> {
    this.assertScope(scope);
    const validated = validateTasteProfile(profile);
    // Optimistic concurrency protects newer profiles even across server replicas.
    for (let attempt = 0; attempt < 5; attempt++) {
      const item = this.container.item(scope, scope);
      let existing: ProfileDocument | undefined;
      try { existing = (await item.read<ProfileDocument>()).resource; }
      catch (error: any) { if (error.code !== 404) throw error; }
      if (existing && existing.profile.updatedAt > validated.updatedAt) return validateTasteProfile(existing.profile);
      const document: ProfileDocument = { id: scope, accountScope: scope, profile: validated };
      try {
        if (existing) {
          if (!existing._etag) throw new Error('Profile version is missing');
          await item.replace(document, { accessCondition: { type: 'IfMatch', condition: existing._etag } });
        } else { await this.container.items.create(document); }
        return validated;
      } catch (error: any) { if (error.code !== 409 && error.code !== 412) throw error; }
    }
    throw new Error('Profile was updated concurrently; retry sync');
  }
}

export function createTasteProfileRepository(): TasteProfileRepository {
  const endpoint = process.env.VELA_COSMOS_ENDPOINT;
  if (!endpoint) return new TasteProfileStore();
  const database = process.env.VELA_COSMOS_DATABASE;
  const container = process.env.VELA_COSMOS_CONTAINER;
  if (!database || !container) throw new Error('Cosmos profile configuration is incomplete');
  const key = process.env.VELA_COSMOS_KEY;
  const client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new ManagedIdentityCredential() });
  return new CosmosTasteProfileStore(client.database(database).container(container));
}

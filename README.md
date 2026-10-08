# Vela Source Engine & Orchestrator (Azure Backend)

High-performance Node.js / Express microservice that acts as the **Source Engine Plane** for the **Vela tvOS** app. By default it searches real, completed files in the authenticated user's TorBox library, parses audio/video release metadata, ranks releases using smart presets (`best`, `balanced`), checks TorBox cache status in batches, resolves direct CDN playback URLs, and provides automatic failure recovery. External indexers are not configured. No mock provider or simulated TorBox cache/stream response is enabled in the server; missing credentials and upstream failures are reported as errors.

---

## 🏛 Architecture Planes

```
┌─────────────────────────────────────────┐
│     Apple TV (Vela Native tvOS App)     │
│  - Catalog UI (TMDB metadata)           │
│  - Video player & hardware decoders     │
│  - Continue Watching & Failover state   │
└────────────┬──────────────────▲─────────┘
             │ 1. Request Play  │ 3. Direct CDN Stream
             ▼                  │    (Zero proxy overhead)
┌─────────────────────────┐     │
│ Vela Backend (Azure)    │     │
│ - Release parsing       │     │
│ - Quality ranking       │     │
│ - TorBox API checks     │     │
│ - Failure recovery      │     │
└────────────┬────────────┘     │
             │ 2. Check cache   │
             ▼                  │
┌─────────────────────────┴─────┴─────────┐
│         TorBox Cloud & Global CDN       │
│  - Cloud debrid engine & cache checks   │
│  - Ultra-fast direct CDN streaming      │
└─────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Local Development)

### 1. Requirements
- Node.js 20+ (Node.js 22 LTS recommended)
- npm 10+

### 2. Installation
```bash
cd Backend
npm install
```

### 3. Build & Run
```bash
# Build TypeScript
npm run build

# Start server (defaults to port 3000)
npm start

# Run unit & HTTP integration tests
npm test
```

Server starts on `http://localhost:3000`. Health endpoint: `http://localhost:3000/health`.

---

## 🐳 Docker Deployment

A multi-stage, non-root hardened `Dockerfile` is provided.

### Local Docker Compose
```bash
cd Backend
docker compose up -d
```

### Manual Docker Build
```bash
docker build -t vela-backend:latest .
docker run -d --name vela-backend -p 3000:3000 vela-backend:latest
```

---

## ☁️ Azure Container Apps Deployment

Azure Container Apps provides serverless container hosting with automated HTTPS, zero-downtime rolling updates, and scale-to-zero capabilities.

### Method 1: Automated Script (`deploy-azure.sh`)
From the repository root or `Backend` directory:
```bash
./Backend/deploy/deploy-azure.sh
```

The script will:
1. Validate Azure CLI (`az`) authentication.
2. Create Resource Group `rg-vela` in `westeurope` (customizable via `AZURE_LOCATION`).
3. Build the container in Azure cloud (no local Docker required) and deploy to Azure Container Apps.
4. Verify `GET /health` on the resulting `https://<fqdn>/health` URL.

### Method 2: Azure CLI One-Liner
```bash
az containerapp up \
  --name vela-source-engine \
  --resource-group rg-vela \
  --location westeurope \
  --source ./Backend \
  --ingress external \
  --target-port 3000 \
  --env-vars NODE_ENV=production PORT=3000
```

### Method 3: Infrastructure as Code (Bicep)
```bash
az deployment group create \
  --resource-group rg-vela \
  --template-file ./Backend/deploy/azure-container-app.bicep \
  --parameters containerImage=vela-backend:latest
```

---

## 📡 REST API Reference

All requests and responses use `application/json`.
Authentication: pass TorBox API key in `Authorization: Bearer <token>` or header `x-api-key: <token>` (or configure `TORBOX_API_KEY` on the backend).

### 1. `GET /health`
Liveness and readiness check probe.
```json
{ "status": "ok", "timestamp": "2026-10-03T20:00:00.000Z", "version": "1.0.0" }
```

### 2. `POST /session/start`
Checks TorBox credentials and provider health. Missing or invalid credentials return a degraded session with torbox=unauthorized.
```json
// Headers: Authorization: Bearer <token>
{ "status": "ready", "sourceEngine": true, "torbox": "ok", "providers": { "healthy": 1, "degraded": 0 } }
```

### 3. `POST /sources/prefetch`
Background warm-up when user views detail page on Apple TV.
```json
{
  "type": "movie",
  "tmdbId": 693134,
  "title": "Dune: Part Two",
  "originalTitle": "Dune: Part Two",
  "year": 2024
}
// Returns 202 Accepted immediately
```

### 4. `POST /play/resolve`
Single-click instant play resolution.
```json
{
  "request": {
    "type": "movie",
    "tmdbId": 693134,
    "title": "Dune: Part Two",
    "year": 2024
  },
  "preset": "best"
}
```
**Response:**
```json
{
  "candidate": {
    "candidateId": "cand_123",
    "quality": "2160p",
    "hdr": ["DV", "HDR10"],
    "videoCodec": "HEVC",
    "audio": ["TrueHD Atmos"],
    "cached": true,
    "badges": ["4K", "Dolby Vision", "Atmos", "⚡ Ready on TorBox"]
  },
  "stream": {
    "streamUrl": "https://cdn.torbox.app/stream/...",
    "mimeType": "video/x-matroska",
    "fileName": "Dune.Part.Two.2024.2160p.UHD.BluRay.x265.mkv",
    "sizeBytes": 28400000000
  }
}
```

### 5. `GET /versions/:mediaKey`
Returns cached versions for the authenticated account. Movie keys use movie:<tmdbId>; episode keys use episode:<tmdbId>:<season>:<episode>. Send the same Authorization header as the resolve request.
```json
{
  "mediaKey": "movie:693134",
  "versions": [ ... ]
}
```

### 6. `POST /playback/failure`
Blacklists failed stream candidate and automatically returns fallback stream.
```json
{
  "candidateId": "cand_123",
  "mediaKey": "movie:693134",
  "request": { ... }
}
```
**Response:**
```json
{
  "status": "fallback_ready",
  "fallback": {
    "candidate": { ... },
    "stream": { "streamUrl": "https://cdn.torbox.app/stream/fallback..." }
  }
}
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for Express HTTP server |
| `HOST` | `0.0.0.0` | Host binding for container networking |
| `NODE_ENV` | `production` | Environment mode |
| `TORBOX_API_KEY` | *(empty)* | Optional default TorBox API key |
| `TORZNAB_URL` | *(empty)* | Optional Torznab indexer API URL (usually ends in `/api`); enables external search |
| `TORZNAB_API_KEY` | *(empty)* | Optional API key for the configured Torznab indexer |
| `TORZNAB_CATEGORIES` | *(empty)* | Optional comma-separated category IDs supported by that indexer |
| `TORZNAB_INDEXERS_JSON` | *(built-in public sources)* | Optional JSON array of indexers; overrides the built-in sources and supports separate keys/categories per source |
| `PORNOLAB_COOKIE` | *(empty)* | Optional cookie for Pornolab search authentication (`bb_session` or full cookie) |
| `PORNOLAB_GAY_COOKIE` | *(falls back to PORNOLAB_COOKIE)* | Optional dedicated cookie for Pornolab Gay provider |
| `GAYTORRENT_COOKIE` | *(empty)* | Optional session cookie for GayTorrent.ru (`gaytor.rent`) private tracker |
| `GTO_COOKIE` | *(empty)* | Optional session cookie for Gay-Torrents.net (`gay-torrents.net`) tracker |
| `TGX_URL` | *(default mirrors)* | Optional custom TorrentGalaxy mirror |
| `TPB_API_URL` | `https://apibay.org` | Optional custom ThePirateBay apibay endpoint |
| `BITSEARCH_URL` | *(default bitsearch.eu)* | Optional custom BitSearch mirror / endpoint |
| `CORS_ORIGIN` | `*` | Allowed CORS origins for browser/API clients |
| `LOG_LEVEL` | `info` | Logger verbosity |

### Adult & Gay adult native providers
Vela includes dedicated adult providers for search and streaming through TorBox:
- **`pornolab`** & **`pornolab-gay`**: Searches Pornolab, with `pornolab-gay` strictly filtering to gay subforums (903, 1755, 1765, 1787, 1767, 1763, 1777, 1691) for movies, HD, and studio packs.
- **`gaytorrent-ru`**: Specialized GayTorrent.ru / `gaytor.rent` parser supporting authenticated sessions via `GAYTORRENT_COOKIE`.
- **`gay-torrents-net`**: Specialized Gay-Torrents.net international tracker parser supporting sessions via `GTO_COOKIE`.
- **`bitsearch-adult`**: Public high-speed JSON REST API search for adult & gay releases with zero authentication, keys, or cookies required.
- **`tpb-adult`** & **`tgx-adult`**: General adult indexers (Apibay/TPB category 500 and TorrentGalaxy XXX categories).

## Source and playback boundaries

The default `TorBoxLibraryProvider` matches localized/original titles and episode numbers against existing account files. When no Torznab configuration is provided, Vela uses the public, anonymous Torlock Torznab source as its primary indexer, with TorBox Library, Rutor, and YTS as additional sources. AniBT and Nyaa are disabled by default. Releases from all enabled providers compete on readiness, playback compatibility and the selected quality preset. Cached releases precede uncached ones; provider names do not override release quality. Both profiles prefer releases with native Apple TV video and audio codecs. Maximum quality favors resolution, HDR and release quality among compatible versions; the native profile additionally favors WEB playback. TrueHD, DTS and software-video releases remain fallbacks when no compatible ready copy exists. File size is not penalized. Legacy data saver requests use maximum quality. Duplicate hashes retain the most complete release metadata and the highest reported seeder count. This sends searched titles to the enabled third-party sources. Set `TORZNAB_INDEXERS_JSON` to your own JSON array to replace these defaults, or set `TORZNAB_URL` for a single custom endpoint. Example JSON shape: `[{"id":"source1","name":"Source 1","url":"https://indexer.example/api","apiKey":"…","categories":"2000,5000"}]`. The indexer URLs and keys stay in backend configuration and are never returned to clients. Torznab results can be played only when TorBox has them cached: on playback, Vela adds a missing result to the user's TorBox library with `add_only_if_cached=true`, so it will not start an uncached download. Configure only indexer endpoints you are authorized to use.

Playback resolves the selected hash through `torrents/mylist`, matches the file using account metadata, and passes numeric torrent/file IDs to `requestdl`. CDN links are validated as HTTPS. Cache and failure exclusions are scoped to a hash of the effective account key; API keys and signed URLs are not logged.

Tests use injected HTTP fixtures, including numeric IDs differing from torrent hashes and cached file IDs, upstream 401/500 failures, network errors, missing titles, account isolation, exact episode versions and HTTP fallback. These checks do not verify a live TorBox account.


### Personal taste profile

The app syncs likes, not-interested flags, manually watched titles, watchlist, viewing progress and recommendation filters via authenticated `GET /profile/taste` and `PUT /profile/taste`. Credentials are required explicitly on these routes even when the server has a default TorBox key. Profile filenames use a SHA-256 account scope; API keys and stream URLs are not part of the stored profile. The AI request includes the user's taste context; no background third-party AI request is made by profile storage itself.

Set `VELA_PROFILE_DIRECTORY` to a writable **persistent mounted directory**. The Docker image uses `/app/data/profiles`; Docker Compose mounts a named volume on `/app/data`. An Azure Container App's container filesystem is ephemeral: attach persistent storage before relying on server-side recovery after container replacement. Run a single backend replica when using this file store; it serializes and atomically replaces writes within one process, but does not provide distributed locking across replicas. The existing Azure deployment template does not provision this persistent volume automatically. Do not deploy this profile store with the template's default multiple replicas without configuring storage and limiting replicas to one.

The app retains local data and dirty state when sync fails, retries with backoff (30 seconds up to five minutes), and exposes sync status and a manual retry in Settings. Removing watchlist items or clearing history is sent as a new snapshot rather than resurrecting deleted records by union merging. Older snapshots cannot overwrite newer server snapshots. Actual cloud deployment and storage provisioning are separate from local validation.

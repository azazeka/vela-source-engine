// Automatically load .env if present
try {
  (process as any).loadEnvFile?.();
} catch {}

import { createApp } from './api/server';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const { app } = createApp();

app.listen(PORT, HOST, () => {
  console.log(`🚀 Vela Source Engine & Orchestrator running on http://${HOST}:${PORT}`);
  console.log(`📡 Ready for Apple TV connections via REST API`);
});

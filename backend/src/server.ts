import { createApp } from './app.js';
import { config } from './config.js';
import { startSweeper } from './domain/sweeper.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Frontdesk backend listening on port ${config.port} (${config.nodeEnv})`);
  // Start background sweeper (runs breach detection & auto-close checks every 60s)
  startSweeper();
});

export default server;

import dotenv from 'dotenv';
import path from 'path';

// Load .env from root or backend
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // fallback

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/frontdesk',
  databaseUrlTest: process.env.DATABASE_URL_TEST || 'postgresql://postgres@127.0.0.1:5433/frontdesk_test',
  jwtSecret: process.env.JWT_SECRET || 'arvo-frontdesk-super-secret-jwt-key-2026',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowDemoSeed: process.env.ALLOW_DEMO_SEED !== 'false',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
};

import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: false, // allow inline scripts for simple react bundle if needed
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint (spec: 200 ok, no DB writes)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API router placeholder (will be attached in phase 4)
  // Static frontend serving
  const frontendDist = path.resolve(__dirname, '../../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } });
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return app;
}

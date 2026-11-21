import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { loginAgent, requireAuth } from './http/auth.js';
import { portalRouter } from './http/routes/portal.js';
import { agentTicketsRouter } from './http/routes/agentTickets.js';
import { adminRouter } from './http/routes/admin.js';
import { reportsRouter } from './http/routes/reports.js';
import { auditRouter } from './http/routes/audit.js';
import { errorHandler } from './http/errors.js';
import { config } from './config.js';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint (spec: 200 ok, no DB writes)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth routes
  app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const { user, token } = await loginAgent(email, password);
      res.cookie('fd_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.json({ user, token });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.clearCookie('fd_token');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  // Mount API routers
  app.use('/api/portal', portalRouter);
  app.use('/api/tickets', agentTicketsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit', auditRouter);

  // Global API error handler
  app.use('/api', errorHandler);

  // Static frontend serving and SPA fallback
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

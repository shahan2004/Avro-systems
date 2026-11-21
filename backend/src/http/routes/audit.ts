import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireLead } from '../auth.js';
import { verifyAuditChain } from '../../domain/audit.js';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.use(requireLead);

// GET /api/audit/verify: Cryptographic audit verification
auditRouter.get('/verify', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await verifyAuditChain();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

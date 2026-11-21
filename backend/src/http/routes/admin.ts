import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth, requireLead } from '../auth.js';
import { AppError } from '../../domain/ticketService.js';

export const adminRouter = Router();

// Agents list (any authenticated agent can see for assignment dropdown)
adminRouter.get('/agents', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query<{ id: string; name: string; email: string; role: string }>(
      `SELECT id, name, email, role FROM agents WHERE active = true ORDER BY name ASC`
    );
    res.json({ agents: result.rows });
  } catch (err) {
    next(err);
  }
});

// Holidays CRUD (Lead only)
adminRouter.get('/holidays', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query<{ day: string; name: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') as day, name FROM holidays ORDER BY day ASC`
    );
    res.json({ holidays: result.rows });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/holidays', requireAuth, requireLead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { day, name } = req.body;
    if (!day || !name) {
      throw new AppError(400, 'INVALID_INPUT', 'day (YYYY-MM-DD) and name are required');
    }
    await query(
      `INSERT INTO holidays (day, name)
       VALUES ($1::date, $2)
       ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name`,
      [day, name]
    );
    res.status(201).json({ ok: true, day, name });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/holidays/:day', requireAuth, requireLead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const day = req.params.day;
    await query(`DELETE FROM holidays WHERE day = $1::date`, [day]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

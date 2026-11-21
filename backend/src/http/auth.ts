import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { AppError } from '../domain/ticketService.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'lead';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.fd_token || req.headers.authorization?.replace(/^Bearer\s+/, '');

  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid token' } });
  }
}

export function requireLead(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'lead') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Lead privilege required' } });
    return;
  }
  next();
}

export async function loginAgent(email: string, pass: string): Promise<{ user: AuthUser; token: string }> {
  const res = await query<{
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: 'agent' | 'lead';
    active: boolean;
  }>(`SELECT id, name, email, password_hash, role, active FROM agents WHERE email = $1`, [email.toLowerCase().trim()]);

  if (res.rowCount === 0 || !res.rows[0].active) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const agent = res.rows[0];
  const valid = await bcrypt.compare(pass, agent.password_hash);
  if (!valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const user: AuthUser = {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
  };
  const token = signToken(user);
  return { user, token };
}

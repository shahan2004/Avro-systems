import { Request, Response, NextFunction } from 'express';
import { AppError } from '../domain/ticketService.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...err.extras,
      },
    });
    return;
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
  });
}

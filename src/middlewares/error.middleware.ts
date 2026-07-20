import { Request, Response, NextFunction } from 'express';
import { env } from '../config/environment.js';

// Classe d'erreur personnalisée de niveau production
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Permet de distinguer nos erreurs gérées des bugs inattendus du système

    Error.captureStackTrace(this, this.constructor);
  }
}

// Middleware global de gestion des erreurs Express
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Une erreur interne est survenue sur le serveur.';

  // Logger l'erreur en interne pour le monitoring de production
  if (statusCode === 500) {
    console.error('💥 ERREUR CRITIQUE NON GÉRÉE :', err);
  } else {
    console.warn(`⚠️ Erreur opérationnelle (${statusCode}) : ${message}`);
  }

  // Réponse renvoyée au client (Mobile / Web)
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    // On n'affiche la stack trace de débogage qu'en mode développement
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

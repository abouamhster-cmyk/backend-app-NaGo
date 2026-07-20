import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis.js';
import { AppError } from './error.middleware.js';

interface RateLimitConfig {
  windowSeconds: number; // Temps de la fenêtre de contrôle
  maxRequests: number;   // Nombre maximum de requêtes autorisées dans cette fenêtre
}

// Configuration par défaut : Max 100 requêtes par minute par IP
const DEFAULT_CONFIG: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 100,
};

export const rateLimiter = (config: RateLimitConfig = DEFAULT_CONFIG) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Si Redis n'est pas prêt, on laisse passer pour ne pas bloquer l'app (mode dégradé)
    if (!redisClient.isOpen) {
      return next();
    }

    // Identification de l'utilisateur par son IP (ou son ID utilisateur s'il est connecté)
    const identifier = req.ip || 'unknown_ip';
    const redisKey = `rate_limit:${identifier}`;

    try {
      // Incrémentation du compteur de requêtes dans Redis
      const requestsCount = await redisClient.incr(redisKey);

      // Si c'est la première requête de cette fenêtre, on définit la durée de vie de la clé (TTL)
      if (requestsCount === 1) {
        await redisClient.expire(redisKey, config.windowSeconds);
      }

      // Si le seuil maximum est dépassé, on bloque la requête
      if (requestsCount > config.maxRequests) {
        const ttl = await redisClient.ttl(redisKey);
        res.setHeader('Retry-After', ttl);
        return next(new AppError("Trop de requêtes effectuées. Veuillez patienter avant de réessayer.", 429));
      }

      // Optionnel : ajouter des en-têtes d'information de limite sur la réponse HTTP
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - requestsCount));

      next();
    } catch (error) {
      // En cas d'erreur de cache Redis, on continue pour éviter d'interrompre le service
      console.error('⚠️ Erreur Rate Limiter Redis (Passage en mode dégradé) :', error);
      next();
    }
  };
};

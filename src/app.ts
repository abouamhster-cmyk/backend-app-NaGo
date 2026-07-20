import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/environment.js';
import { connectRedis, redisClient } from './config/redis.js';
import { supabase } from './config/database.js';

const app = express();

// =========================================================================
// 1. MIDDLEWARES DE SÉCURITÉ ET LOGS (Niveau Production)
// =========================================================================
app.use(helmet()); // Sécurise les en-têtes HTTP contre les vulnérabilités courantes
app.use(cors({
  origin: '*', // À restreindre en production avec les domaines autorisés
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Permet de parser les requêtes JSON volumineuses
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev')); // Logs des requêtes HTTP

// =========================================================================
// 2. ROUTE DE HEALTH CHECK (Indispensable pour Render / AWS)
// =========================================================================
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    // 1. Test de connexion Supabase
    const { data, error } = await supabase.from('profiles').select('id').limit(1);
    const dbStatus = error ? 'DEGRADED' : 'HEALTHY';
    
    // 2. Test de connexion Redis
    const redisStatus = redisClient.isOpen ? 'HEALTHY' : 'UNAVAILABLE';

    const systemHealthy = dbStatus === 'HEALTHY' && redisStatus === 'HEALTHY';

    res.status(systemHealthy ? 200 : 500).json({
      status: systemHealthy ? 'UP' : 'DOWN',
      timestamp: new Date().toISOString(),
      services: {
        database_supabase: dbStatus,
        cache_redis: redisStatus,
      },
      env: env.NODE_ENV
    });
  } catch (error) {
    res.status(500).json({
      status: 'DOWN',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// =========================================================================
// 3. INITIALISATION DU SERVEUR ET DES CONNEXIONS
// =========================================================================
const startServer = async () => {
  try {
    // Connexion obligatoire à Redis
    await connectRedis();

    // Démarrage de l'écoute sur le port configuré
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Serveur de production NaGo démarré sur le port ${env.PORT} [Mode: ${env.NODE_ENV}]`);
    });

    // Gestion de l'arrêt propre (Graceful Shutdown)
    const shutdown = async () => {
      console.log('🔌 Arrêt du serveur en cours...');
      server.close(async () => {
        console.log('HTTP server closed.');
        if (redisClient.isOpen) {
          await redisClient.quit();
          console.log('Redis connection closed.');
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Erreur critique lors du démarrage du serveur :', error);
    process.exit(1);
  }
};

startServer();

export default app;

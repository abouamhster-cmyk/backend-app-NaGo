import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Configurations et Connecteurs
import { env } from './config/environment.js';
import { connectRedis, redisClient } from './config/redis.js';
import { supabase } from './config/database.js';

// Routes et Middlewares
import authRoutes from './routes/auth.routes.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { rateLimiter } from './middlewares/rate-limiter.js';

// Passerelle WebSockets (Tracking GPS)
import { setupTrackerGateway } from './websocket/tracker.gateway.js';

import rideRoutes from './routes/rides.routes.js';


const app = express();

// =========================================================================
// 1. MIDDLEWARES GLOBAUX (Sécurité, Logs et Limites)
// =========================================================================
app.use(helmet()); // Sécurise les en-têtes HTTP
app.use(cors({
  origin: '*', // À restreindre en production avec les domaines autorisés
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Parse le format JSON
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev')); // Logger HTTP

// ACTIVATION DU LIMITEUR DE SÉCURITÉ REDIS
app.use(rateLimiter()); 

// Raccordement des routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes); 
// =========================================================================
// 2. ROUTE DE HEALTH CHECK (Indispensable pour Render / AWS)
// =========================================================================
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    // 1. Test de connexion Supabase
    const { error } = await supabase.from('profiles').select('id').limit(1);
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
// 3. GESTION DES ERREURS (Doit être placé après toutes les routes)
// =========================================================================
app.use(errorHandler);

// =========================================================================
// 4. INITIALISATION DU SERVEUR ET DES CONNEXIONS (Node.js natif + WebSockets)
// =========================================================================
const startServer = async () => {
  try {
    // 1. Connexion obligatoire au cache Redis
    await connectRedis();

    // 2. Création du serveur HTTP natif rattaché à Express (requis pour Socket.io)
    const httpServer = createServer(app);

    // 3. Initialisation de Socket.io pour la communication bidirectionnelle en temps réel
    const io = new Server(httpServer, {
      cors: {
        origin: '*', // À restreindre en production
        methods: ['GET', 'POST']
      }
    });

    // 4. Lancement de notre passerelle de tracking GPS temps réel
    setupTrackerGateway(io);

    // 5. Démarrage de l'écoute sur le port configuré
    const server = httpServer.listen(env.PORT, () => {
      console.log(`🚀 Serveur de production NaGo démarré sur le port ${env.PORT} [Mode: ${env.NODE_ENV}]`);
    });

    // 6. Gestion de l'arrêt propre (Graceful Shutdown)
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

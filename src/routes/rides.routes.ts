import { Router } from 'express';
import { createRideRequest, getNearbyDrivers } from '../controllers/ride.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Toutes les routes de ce fichier exigent une authentification valide
router.use(requireAuth as any);

// Route pour afficher les conducteurs à proximité du client
router.get('/nearby', getNearbyDrivers);

// Route pour initier une demande de course/livraison
router.post('/', createRideRequest);

export default router;

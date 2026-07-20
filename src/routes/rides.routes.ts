import { Router } from 'express';
import { createRideRequest, getNearbyDrivers, submitBid, acceptBid } from '../controllers/ride.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(requireAuth as any);

router.get('/nearby', getNearbyDrivers);
router.post('/', createRideRequest);

// Nouvelles routes pour le système d'enchères
router.post('/bid', submitBid);        // Accessible par les prestataires (Zems, chauffeurs)
router.post('/accept', acceptBid);    // Accessible par les clients
router.patch('/status', updateRideStatus); // Mise à jour de l'étape de suivi par le prestataire


export default router;

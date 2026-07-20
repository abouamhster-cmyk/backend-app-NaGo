import { Router } from 'express';
import { declareCashPayment, validateCashPayment } from '../controllers/payment.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Toutes les transactions exigent que l'utilisateur soit connecté
router.use(requireAuth as any);

router.post('/declare-cash', declareCashPayment);  // Appelé par le prestataire
router.post('/validate-cash', validateCashPayment); // Appelé par le client

export default router;

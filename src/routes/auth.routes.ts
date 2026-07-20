import { Router } from 'express';
import { registerUser } from '../controllers/auth.controller.js';

const router = Router();

// Route publique d'inscription (qui nécessite seulement un JWT Supabase valide)
router.post('/register', registerUser);

export default router;

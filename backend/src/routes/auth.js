import { Router } from 'express';
import { callback, login, logout } from '../controllers/auth.js';
import { requireSameOrigin } from '../middleware/session.js';
import { asyncRoute } from '../utils/async-route.js';

export const authRouter = Router();
authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
authRouter.get('/login', asyncRoute(login));
authRouter.get('/callback', asyncRoute(callback));
authRouter.post('/logout', requireSameOrigin, asyncRoute(logout));

import { Router } from 'express';
import { asyncRoute } from '../utils/async-route.js';
import { receivePigeon } from '../controllers/pigeon.js';
import { authenticatePigeon } from '../middleware/pigeon.js';

export const webhookRouter = Router();

webhookRouter.post('/pigeon', asyncRoute(authenticatePigeon), asyncRoute(receivePigeon));


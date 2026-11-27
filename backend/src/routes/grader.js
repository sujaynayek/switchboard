import { json, Router } from 'express';
import { claim, getSnapshot, reply, reset } from '../controllers/grader.js';
import { requireGrader } from '../middleware/grader.js';
import { asyncRoute } from '../utils/async-route.js';

export const graderRouter = Router();
graderRouter.use(requireGrader);
graderRouter.post('/reset', asyncRoute(reset));
graderRouter.get('/snapshot', asyncRoute(getSnapshot));
graderRouter.post('/reply', json(), asyncRoute(reply));
graderRouter.post('/claim', json(), asyncRoute(claim));

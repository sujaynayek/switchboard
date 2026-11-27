import { json, Router } from 'express';
import { changeState, claim, detail, history, list, reply } from '../controllers/api.js';
import { requireSameOrigin, requireSession, requireWorkspace } from '../middleware/session.js';
import { asyncRoute } from '../utils/async-route.js';

export const apiRouter = Router();
apiRouter.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
}, asyncRoute(requireSession));
apiRouter.get('/me', (req, res) => res.json(req.session));

const threads = Router();
threads.use(requireWorkspace);
threads.get('/', asyncRoute(list));
threads.get('/:contact', asyncRoute(detail));
threads.get('/:contact/messages', asyncRoute(history));
threads.post('/:contact/claim', requireSameOrigin, asyncRoute(claim));
threads.post('/:contact/reply', requireSameOrigin, json(), asyncRoute(reply));
threads.post('/:contact/close', requireSameOrigin, asyncRoute(changeState('closed')));
threads.post('/:contact/reopen', requireSameOrigin, asyncRoute(changeState('open')));
apiRouter.use('/conversations', threads);

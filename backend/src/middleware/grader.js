import { config } from '../config/env.js';
import { secretsMatch } from '../utils/secrets.js';

export function requireGrader(req, res, next) {
  if (!secretsMatch(req.get('x-grader-token'), config.graderToken)) return res.sendStatus(401);
  next();
}

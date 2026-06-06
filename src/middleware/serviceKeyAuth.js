/**
 * Internal service auth — validates x-cpa-service-key header.
 * In dev: skipped if CPA_SERVICE_KEY is not set.
 * In prod: required on all /api/media/* routes.
 */
function serviceKeyAuth(req, res, next) {
  const key      = req.headers['x-cpa-service-key'];
  const expected = process.env.CPA_SERVICE_KEY;

  if (!expected) {
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(500).json({ error: 'Service key not configured' });
  }

  if (!key || key !== expected) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  next();
}

module.exports = { serviceKeyAuth };

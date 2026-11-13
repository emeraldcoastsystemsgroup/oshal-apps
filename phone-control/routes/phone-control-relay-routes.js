/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Forward two closed saved-relay requests to the native original-Jarvis scope, without credentials, local state, retries or bridge fallback.
 */
'use strict';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BINDING_ID = new RegExp(`^${UUID}$`);
const TARGET_ID = new RegExp(`^node-${UUID}$`);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(res) {
  return res.status(400).json({ error: 'native_relay_selection_invalid',
    message: 'Select the exact TV and its saved active phone connection. Other actions and extra fields are not accepted.' });
}

async function invoke(ctx, res, name, input) {
  res.setHeader('Cache-Control', 'no-store');
  if (typeof ctx?.intent !== 'function') {
    return res.status(503).json({ error: 'native_relay_unavailable',
      message: 'Native relay support is unavailable for this request. Use an original Jarvis conversation.' });
  }
  try {
    const result = await ctx.intent(name, input);
    if (!object(result) || Object.keys(result).length === 0) {
      return res.status(502).json({ error: 'native_relay_response_invalid',
        message: 'No valid native result was received. Do not retry automatically.' });
    }
    return res.json(result);
  } catch {
    return res.status(503).json({ error: 'native_relay_refused',
      message: 'No verified native result was received. Review the connection in the original Jarvis conversation; do not retry automatically.' });
  }
}

function mountNativeRelay(router, ctx) {
  router.get('/relay-bindings', (req, res) => {
    const body = req.body ?? {};
    if (Object.keys(req.query || {}).length || !object(body) || Object.keys(body).length) return invalid(res);
    return invoke(ctx, res, 'device.relay.bindings', {});
  });
  router.post('/relay-bindings/:binding/open-orbit', (req, res) => {
    const body = req.body;
    if (Object.keys(req.query || {}).length || !object(body)
      || Object.keys(body).some((key) => key !== 'target_device_id' && key !== 'binding_id')
      || !Object.hasOwn(body, 'target_device_id') || typeof body.target_device_id !== 'string'
      || Object.hasOwn(body, 'binding_id') && body.binding_id !== req.params.binding
      || !TARGET_ID.test(body.target_device_id) || !BINDING_ID.test(req.params.binding)) return invalid(res);
    return invoke(ctx, res, 'device.relay.open_orbit', { target_device_id: body.target_device_id, binding_id: req.params.binding });
  });
}

module.exports = { mountNativeRelay };

// The Flutter client expects `status` to be the FIRST key of every JSON body.
// Never use 401/403 for business errors: the app logs the user out on those codes.
function ok(res, message, data = null, code = 200) {
  return res.status(code).json({ status: true, message, data });
}

function fail(res, message, code = 400, data = null) {
  return res.status(code).json({ status: false, message, data });
}

class HttpError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ok, fail, HttpError, wrap };

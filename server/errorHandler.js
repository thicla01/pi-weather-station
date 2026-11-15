// Terminal Express error handler: the last middleware of server/index.js.
//
// Why it exists: the server had no error middleware of its own, so every
// error that reached Express went to its default handler (finalhandler). Up
// to Express 5.2 that handler logged `err.stack`. Express 5.3 logs the WHOLE
// error object (`console.error(err)`, i.e. util.inspect), which puts into
// server.log whatever the error carries:
//   - a malformed JSON body: body-parser's error holds the raw request body
//     (`body`, inspected up to 10 000 characters). bodyParser.json() is
//     mounted for the whole app, before the rate limiters and the
//     localhostOnly gates, so any client that reaches the port can write
//     ~11 KB into the log per request (1.3 KB before 5.3);
//   - an AxiosError that escapes a controller: its `config.url` and its
//     request carry the upstream URL, API key included (Tomorrow.io's
//     `apikey=`, Mapbox's `access_token=`, LocationIQ's `key=` …). Every axios
//     call is caught today (reviewed 2026-11-15), but nothing enforces it.
//
// What it does instead — finalhandler's status and headers for the client (a
// plain-text status text instead of its small HTML page), and ONE sanitized
// line in the log:
//   - status: err.status / err.statusCode when it is an integer 4xx-5xx, else
//     the response's status when that is 4xx-5xx, else 500 (finalhandler's
//     rule); Content-Encoding / Content-Language / Content-Range removed and
//     err.headers applied only when the status came from the error, as it does;
//   - body: the HTTP status text (« Bad Request », « Internal Server Error »),
//     never the stack or the message (finalhandler under NODE_ENV=production,
//     which the systemd unit and the launchd plist both set);
//   - log: `[error] <status> <METHOD> <path> — <kind>[: <detail>]`, the path
//     without its query string (it carries the kiosk's coordinates) and cut at
//     200 characters. An error whose message may quote its input logs its kind
//     only: a body-parser error (it has a string `type`, e.g.
//     entity.parse.failed), a SyntaxError (V8's JSON.parse messages quote a
//     slice of the input) and Node's ERR_INVALID_* argument errors (they quote
//     the value received). Any other error logs the first line of its message,
//     cut at 200 characters, with credential query parameters (apikey, key,
//     token, access_token, password, secret, any case) redacted; a 5xx also
//     logs its stack frames (the « at … » lines, as Express ≤ 5.2 did),
//     redacted the same way.
//   - the handler never throws back to Express: a failure to format the line
//     logs a fixed line, a failure to answer ends or destroys the response.
//   - headers already sent: the line is logged and the socket destroyed, as
//     finalhandler does — never a second response, never next(err) (which
//     would hand the error back to finalhandler and its full-object log).

const http = require("http");

const MAX_DETAIL_CHARS = 200;
const MAX_STACK_FRAMES = 10;
// Query parameters whose value is a credential in the URLs this server calls.
const SECRET_PARAM_RE = /((?:^|[?&;\s"'(,{[])(?:apikey|api_key|key|token|access_token|password|secret)=)[^&;\s"'#)\]}]+/gi;
// Errors whose message may quote the input that caused them: their kind only.
const QUOTES_INPUT = (err) => err.name === "SyntaxError" || (typeof err.code === "string" && err.code.startsWith("ERR_INVALID"));

/**
 * Replace the value of every credential-like query parameter in a string.
 *
 * @param {string} text - Any text that may hold a URL.
 * @returns {string} The text with each credential value replaced by « <redacted> ».
 */
function redactSecrets(text) {
  return String(text).replace(SECRET_PARAM_RE, "$1<redacted>");
}

/**
 * The HTTP status the client receives, by finalhandler's rule.
 *
 * @param {*} err - The error passed to next().
 * @param {object} res - The Express response.
 * @returns {{status: number, fromError: boolean}} The status, and whether it came from the error.
 */
function errorStatus(err, res) {
  for (const s of [err && err.status, err && err.statusCode]) {
    if (Number.isInteger(s) && s >= 400 && s < 600) return { status: s, fromError: true };
  }
  const r = res && res.statusCode;
  return { status: typeof r === "number" && r >= 400 && r <= 599 ? r : 500, fromError: false };
}

/**
 * The one log line (plus, for a 5xx, its redacted stack frames) for an error.
 *
 * @param {*} err - The error passed to next().
 * @param {{method?: string, originalUrl?: string, url?: string}} req - The Express request.
 * @param {number} status - The status sent to the client.
 * @returns {string} The text to log; never the request body, the query string or a credential.
 */
function formatErrorLine(err, req, status) {
  const method = (req && req.method) || "?";
  const rawPath = String((req && (req.originalUrl || req.url)) || "").split("?")[0] || "?";
  const path = rawPath.length > MAX_DETAIL_CHARS ? `${rawPath.slice(0, MAX_DETAIL_CHARS)}…` : rawPath;
  const isObj = err !== null && typeof err === "object";
  let kind;
  let detail = "";
  if (isObj && typeof err.type === "string" && err.type) {
    // body-parser / raw-body errors: the type says it all; the message may quote the body.
    kind = err.type;
  } else if (isObj && QUOTES_INPUT(err)) {
    kind = String(err.code || err.name);
  } else {
    kind = String((isObj && (err.code || err.name)) || typeof err);
    const msg = isObj ? err.message : err;
    if (msg !== undefined && msg !== null && String(msg) !== "") {
      const first = String(msg).split("\n")[0];
      detail = redactSecrets(first.length > MAX_DETAIL_CHARS ? `${first.slice(0, MAX_DETAIL_CHARS)}…` : first);
    }
  }
  let line = `[error] ${status} ${method} ${path} — ${kind}${detail ? `: ${detail}` : ""}`;
  if (status >= 500 && isObj && typeof err.stack === "string") {
    const frames = err.stack.split("\n").filter((l) => /^\s+at\s/.test(l)).slice(0, MAX_STACK_FRAMES);
    if (frames.length) line += `\n${redactSecrets(frames.join("\n"))}`;
  }
  return line;
}

/**
 * Build the terminal error middleware.
 *
 * @param {{log?: function(string): void}} [options] - `log` receives the line (default console.error).
 * @returns {function(*, object, object, function): void} An Express error middleware (four arguments).
 */
function makeTerminalErrorHandler({ log = (line) => console.error(line) } = {}) {
  // The fourth parameter is what makes Express treat this as error middleware.
  return function terminalErrorHandler(err, req, res, _next) {
    let status = 500;
    let fromError = false;
    try {
      ({ status, fromError } = errorStatus(err, res));
    } catch {
      // A hostile getter on the error: keep 500.
    }
    try {
      log(formatErrorLine(err, req, status));
    } catch {
      try {
        log(`[error] ${status} — (the error could not be described)`);
      } catch {
        // A logging failure must never turn into a second error.
      }
    }
    if (res.headersSent) {
      if (req && req.socket) req.socket.destroy();
      return;
    }
    try {
      for (const name of ["Content-Encoding", "Content-Language", "Content-Range"]) res.removeHeader(name);
      if (fromError && err.headers && typeof err.headers === "object") {
        for (const [name, value] of Object.entries(err.headers)) {
          try {
            res.setHeader(name, value);
          } catch {
            // An invalid header name or value from the error is dropped.
          }
        }
      }
      res.status(status).type("text/plain").send(http.STATUS_CODES[status] || "Error");
    } catch {
      // Never hand the error back to Express (finalhandler would log the whole object).
      try {
        res.statusCode = 500;
        res.end();
      } catch {
        if (req && req.socket) req.socket.destroy();
      }
    }
  };
}

const terminalErrorHandler = makeTerminalErrorHandler();

module.exports = { terminalErrorHandler, makeTerminalErrorHandler, formatErrorLine, redactSecrets, errorStatus };

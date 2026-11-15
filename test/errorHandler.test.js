// Regression tests for the terminal Express error handler (server/errorHandler.js).
// Express 5.3's default handler logs the whole error object: a malformed JSON
// body, or an escaped AxiosError with its API key, would reach server.log.
// These lock down that the handler answers with finalhandler's status and
// headers, logs ONE sanitized line, never lets anything else reach the console
// or hands the error back to Express, and that server/index.js mounts it last.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { AxiosError } = require("axios");

const { makeTerminalErrorHandler, formatErrorLine, redactSecrets, errorStatus } = require("../server/errorHandler");

const BODY_MARKER = "SECRET-BODY-MARKER-7f3a";
const KEY_MARKER = "SECRETKEY9a8b7c";
const COORD_MARKER = "45.50884";

// A real Express app with the same body parser as the server, failing routes,
// the handler under test, and after it a sentinel error middleware: anything
// the handler hands back to Express (next(err), or an error it throws) lands
// in `escaped` instead of finalhandler's full-object log.
function makeApp() {
  const lines = [];
  const escaped = [];
  const app = express();
  app.use(bodyParser.json());
  app.post("/api/echo", (req, res) => res.json({ ok: true }));
  app.get("/api/axios-401", (req, res, next) => {
    const url = `https://api.tomorrow.io/v4/weather/realtime?location=1,2&apikey=${KEY_MARKER}`;
    next(new AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", { url }, { path: url }, { status: 401, headers: {}, config: { url } }));
  });
  app.get("/api/axios-503", (req, res, next) => {
    const url = `https://api.tomorrow.io/v4/weather/realtime?apikey=${KEY_MARKER}`;
    next(new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE", { url }, { path: url }, { status: 503, headers: {}, config: { url } }));
  });
  app.get("/api/throws", () => {
    throw new Error(`boom while calling https://example.test/x?token=${KEY_MARKER}&a=1`);
  });
  app.get("/api/frame-key", (req, res, next) => {
    const err = new Error("upstream failed");
    err.stack = `Error: upstream failed\n    at fetchIt (https://h/p?apikey=${KEY_MARKER}:1:2)\n    at Layer.handle (/srv/x.js:3:4)`;
    next(err);
  });
  app.get("/api/parse-query", (req) => {
    JSON.parse(String(req.query.x));
  });
  app.get("/api/teapot", (req, res, next) => {
    const err = new Error("short and stout");
    err.status = 418;
    err.headers = { "X-Test-Header": "from-error" };
    next(err);
  });
  app.get("/api/headers-no-status", (req, res, next) => {
    res.setHeader("Content-Language", "fr");
    const err = new Error("no status here");
    err.headers = { "X-Test-Header": "from-error" };
    next(err);
  });
  app.get("/api/bad-status", (req, res, next) => {
    const err = new Error("fractional status");
    err.status = 404.5;
    err.headers = { "X-Bad": undefined };
    next(err);
  });
  app.get("/api/partial", (req, res, next) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("partial");
    next(new Error("after headers"));
  });
  app.use(makeTerminalErrorHandler({ log: (l) => lines.push(l) }));
  // The sentinel — never calls next(), so nothing reaches finalhandler.
  app.use((err, req, res, _next) => {
    escaped.push(err);
    if (res.headersSent) req.socket.destroy();
    else res.status(599).end();
  });
  return { app, lines, escaped };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method = "GET", path: p, body, headers = {} }) {
  return new Promise((resolve) => {
    const { port } = server.address();
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, complete: res.complete }));
      res.on("error", (e) => resolve({ status: res.statusCode, headers: res.headers, body: data, error: e }));
      res.on("aborted", () => resolve({ status: res.statusCode, headers: res.headers, body: data, error: new Error("aborted") }));
    });
    req.on("error", (e) => resolve({ error: e }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// One request against a fresh app, with console.error and console.log spied:
// the handler logs only through its injected `log`, so they must stay silent.
async function run(opts) {
  const { app, lines, escaped } = makeApp();
  const server = await listen(app);
  const consoleCalls = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a) => consoleCalls.push(a);
  console.log = (...a) => consoleCalls.push(a);
  try {
    const res = await request(server, opts);
    await new Promise((r) => setImmediate(r));
    return { res, lines, escaped, consoleCalls };
  } finally {
    console.error = origErr;
    console.log = origLog;
    server.close();
  }
}

function assertClean(r) {
  assert.equal(r.escaped.length, 0, "the handler must never hand the error back to Express");
  assert.equal(r.consoleCalls.length, 0, "nothing but the handler's own line may be logged");
  for (const l of r.lines) {
    for (const m of [BODY_MARKER, KEY_MARKER, COORD_MARKER]) assert.ok(!l.includes(m), `the log must not contain ${m}`);
  }
}

test("errorHandler: a malformed JSON body → 400 « Bad Request », one line without the body", async () => {
  const body = `{"a": "${BODY_MARKER}${"x".repeat(5000)}", }`;
  const r = await run({ method: "POST", path: `/api/echo?lat=${COORD_MARKER}&lon=-73.5`, body, headers: { "Content-Type": "application/json" } });
  assert.equal(r.res.status, 400);
  assert.equal(r.res.body, "Bad Request");
  assert.match(r.res.headers["content-type"], /^text\/plain/);
  assert.deepEqual(r.lines, ["[error] 400 POST /api/echo — entity.parse.failed"]);
  assertClean(r);
});

test("errorHandler: a very long path is cut in the log", async () => {
  const p = `/${"p".repeat(12000)}?lat=${COORD_MARKER}`;
  const r = await run({ method: "POST", path: p, body: "{,}", headers: { "Content-Type": "application/json" } });
  assert.equal(r.res.status, 400);
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].length < 300, `the line stays short (${r.lines[0].length})`);
  assertClean(r);
});

test("errorHandler: an escaped AxiosError (upstream 401) → 401, one line, no URL, no key, no stack", async () => {
  const r = await run({ path: "/api/axios-401" });
  assert.equal(r.res.status, 401);
  assert.equal(r.res.body, "Unauthorized");
  assert.deepEqual(r.lines, ["[error] 401 GET /api/axios-401 — ERR_BAD_REQUEST: Request failed with status code 401"]);
  assert.ok(!r.lines[0].includes("tomorrow.io"));
  assertClean(r);
});

test("errorHandler: an escaped AxiosError (upstream 503) → 503 with its stack frames, still no URL or key", async () => {
  const r = await run({ path: "/api/axios-503" });
  assert.equal(r.res.status, 503);
  assert.equal(r.lines.length, 1);
  const [first, ...frames] = r.lines[0].split("\n");
  assert.equal(first, "[error] 503 GET /api/axios-503 — ERR_BAD_RESPONSE: Request failed with status code 503");
  assert.ok(frames.length >= 1 && frames.every((f) => /^\s+at\s/.test(f)));
  assert.ok(!r.lines[0].includes("tomorrow.io"));
  assertClean(r);
});

test("errorHandler: a thrown error → 500, its message and stack frames logged with credential parameters redacted", async () => {
  const r = await run({ path: "/api/throws" });
  assert.equal(r.res.status, 500);
  assert.equal(r.res.body, "Internal Server Error");
  const [first, ...frames] = r.lines[0].split("\n");
  assert.equal(first, "[error] 500 GET /api/throws — Error: boom while calling https://example.test/x?token=<redacted>&a=1");
  assert.ok(frames.length >= 1 && frames.every((f) => /^\s+at\s/.test(f)));
  assertClean(r);
});

test("errorHandler: a credential inside a stack frame is redacted", async () => {
  const r = await run({ path: "/api/frame-key" });
  assert.equal(r.res.status, 500);
  // The redacted value runs to the next delimiter: the frame's « :1:2 » goes with it.
  assert.equal(r.lines[0], "[error] 500 GET /api/frame-key — Error: upstream failed\n    at fetchIt (https://h/p?apikey=<redacted>)\n    at Layer.handle (/srv/x.js:3:4)");
  assertClean(r);
});

test("errorHandler: a SyntaxError logs its kind only (its message quotes the input)", async () => {
  const r = await run({ path: `/api/parse-query?x=lat=${COORD_MARKER}` });
  assert.equal(r.res.status, 500);
  assert.equal(r.lines[0].split("\n")[0], "[error] 500 GET /api/parse-query — SyntaxError");
  assertClean(r);
});

test("errorHandler: err.status and err.headers are honoured, as finalhandler does", async () => {
  const r = await run({ path: "/api/teapot" });
  assert.equal(r.res.status, 418);
  assert.equal(r.res.headers["x-test-header"], "from-error");
  assert.equal(r.res.body, http.STATUS_CODES[418]);
  assert.deepEqual(r.lines, ["[error] 418 GET /api/teapot — Error: short and stout"], "a 4xx logs no stack");
  assertClean(r);
});

test("errorHandler: err.headers ignored without an error status; Content-Language removed", async () => {
  const r = await run({ path: "/api/headers-no-status" });
  assert.equal(r.res.status, 500);
  assert.equal(r.res.headers["x-test-header"], undefined);
  assert.equal(r.res.headers["content-language"], undefined);
  assertClean(r);
});

test("errorHandler: a fractional status and an invalid header never make the handler throw", async () => {
  const r = await run({ path: "/api/bad-status" });
  assert.equal(r.res.status, 500, "404.5 is not a status: 500, as finalhandler's res-status fallback");
  assert.equal(r.lines.length, 1);
  assertClean(r);
});

test("errorHandler: headers already sent → the line is logged and the connection cut, no second response", async () => {
  const r = await run({ path: "/api/partial" });
  assert.ok(r.res.error, "the connection must be cut, never a complete response");
  if (r.res.status !== undefined) assert.equal(r.res.status, 200);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /^\[error\] 500 GET \/api\/partial — Error: after headers/);
  assertClean(r);
});

test("errorHandler: formatErrorLine and the pure helpers", () => {
  const req = { method: "POST", originalUrl: "/api/x?lat=1&lon=2" };
  const tooLarge = Object.assign(new Error(`request entity too large ${BODY_MARKER}`), { type: "entity.too.large", status: 413 });
  assert.equal(formatErrorLine(tooLarge, req, 413), "[error] 413 POST /api/x — entity.too.large");
  assert.equal(formatErrorLine("a string", req, 500), "[error] 500 POST /api/x — string: a string");
  assert.equal(formatErrorLine(undefined, {}, 500), "[error] 500 ? ? — undefined");
  const argErr = Object.assign(new TypeError(`The "x" argument … Received type number (${COORD_MARKER})`), { code: "ERR_INVALID_ARG_TYPE" });
  assert.equal(formatErrorLine(argErr, req, 400), "[error] 400 POST /api/x — ERR_INVALID_ARG_TYPE");
  const line = formatErrorLine(new Error("y".repeat(500)), req, 400);
  assert.ok(line.endsWith("…") && line.length < 300, "a long message is cut at 200 characters");
  assert.equal(formatErrorLine(new Error("one\ntwo"), req, 400), "[error] 400 POST /api/x — Error: one");
  assert.equal(
    redactSecrets("GET https://h/p?apikey=abc&key=def;token=ghi access_token=jkl&x=1"),
    "GET https://h/p?apikey=<redacted>&key=<redacted>;token=<redacted> access_token=<redacted>&x=1",
  );
  assert.equal(redactSecrets("?API_KEY=a&Token=b (apikey=c) ,key=d password=e"), "?API_KEY=<redacted>&Token=<redacted> (apikey=<redacted>) ,key=<redacted> password=<redacted>");
  assert.equal(redactSecrets("apikey=atstart"), "apikey=<redacted>");
  assert.equal(redactSecrets("monkey=banana"), "monkey=banana", "only a parameter boundary starts a key");
  assert.deepEqual(errorStatus({ status: 404 }, { statusCode: 200 }), { status: 404, fromError: true });
  assert.deepEqual(errorStatus({ statusCode: 503 }, {}), { status: 503, fromError: true });
  assert.deepEqual(errorStatus({ status: 304 }, { statusCode: 200 }), { status: 500, fromError: false });
  assert.deepEqual(errorStatus({ status: 404.5 }, { statusCode: 200 }), { status: 500, fromError: false });
  assert.deepEqual(errorStatus({ status: 200 }, { statusCode: 422 }), { status: 422, fromError: false });
  assert.deepEqual(errorStatus(new Error("x"), { statusCode: 200 }), { status: 500, fromError: false });
});

test("errorHandler: server/index.js mounts it last, and registers nothing indented or later", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const calls = [...code.matchAll(/\bapp\.(use|get|post|put|patch|delete|all|route|param)\(/g)];
  assert.ok(calls.length > 10, "the route table was read");
  const last = calls[calls.length - 1];
  assert.equal(code.slice(last.index, code.indexOf("\n", last.index)), "app.use(terminalErrorHandler);", "the terminal error handler must be the last app.* registration");
  assert.deepEqual([...code.matchAll(/^[ \t]+app\.(use|get|post|put|patch|delete|all|route|param)\(/gm)].map((m) => m[0]), [], "no indented app.* registration (e.g. inside a listen callback, which would run after the handler)");
  assert.match(src, /^const \{ terminalErrorHandler \} = require\("\.\/errorHandler"\);$/m);
});

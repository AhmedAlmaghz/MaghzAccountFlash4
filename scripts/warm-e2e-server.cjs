// Warm the vite e2e server: the dependency optimizer blocks the bridge
// during the first page load, and the app's 15s DB-init timeout fires
// before the bridge answers -> the run starts on the DbError screen.
// Poll the bridge until it answers FAST, then touch every route the
// specs use so their modules are already transformed.
const http = require('http');

const BASE = 'http://127.0.0.1:5173';
const ROUTES = [
  '/', '/login', '/pos',
  '/sales/invoices/new', '/sales/quotations/new', '/sales/returns/new', '/sales/customers/new',
  '/purchases/invoices/new', '/purchases/orders/new', '/purchases/returns/new', '/purchases/suppliers/new',
  '/accounting/journal/new', '/accounting/receipt-vouchers/new', '/accounting/payment-vouchers/new',
  '/inventory/products/new', '/manufacturing/bom/new', '/manufacturing/work-orders/new',
  '/sales/invoices',
];

function get(path) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(BASE + path, (res) => {
      res.resume();
      res.on('end', () => resolve({ ms: Date.now() - started, status: res.statusCode }));
    });
    req.on('error', () => resolve({ ms: -1, status: 0 }));
    req.setTimeout(120_000, () => { req.destroy(); resolve({ ms: -1, status: 0 }); });
  });
}

function post(path, body) {
  return new Promise((resolve) => {
    const started = Date.now();
    const data = JSON.stringify(body);
    const req = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ms: Date.now() - started, status: res.statusCode }));
    });
    req.on('error', () => resolve({ ms: -1, status: 0 }));
    req.setTimeout(120_000, () => { req.destroy(); resolve({ ms: -1, status: 0 }); });
    req.write(data);
    req.end();
  });
}

(async () => {
  // 1) wait for the server to accept connections
  for (let i = 0; i < 120; i++) {
    const r = await get('/');
    if (r.status === 200) { console.log(`server up after ${i}s`); break; }
    await new Promise((r2) => setTimeout(r2, 1000));
  }

  // 2) wait for the bridge to answer fast (optimizer done)
  let bridge = { ms: -1 };
  for (let i = 0; i < 180; i++) {
    bridge = await post('/__e2e/db', { sql: 'select 1 as ok', params: [] });
    if (bridge.ms > 0 && bridge.ms < 1500) { console.log(`bridge fast after ${i}s (${bridge.ms}ms)`); break; }
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  if (bridge.ms < 0) { console.log('bridge never answered'); process.exit(1); }

  // 3) touch every route so the modules are transformed
  for (const route of ROUTES) {
    const r = await get(route);
    console.log(`${route} -> ${r.status} (${r.ms}ms)`);
  }
  console.log('WARM_READY');
})();

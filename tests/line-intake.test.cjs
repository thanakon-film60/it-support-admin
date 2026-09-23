// Run the real intake route against an isolated JSON store; no LINE messages are sent.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText, filename);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-intake-'));
process.chdir(tmp);
process.env.INTERNAL_API_KEY = 'local-test-key';
const { POST } = require(path.join(root, 'src/app/api/internal/tickets/route.ts'));
const { listTickets } = require(path.join(root, 'src/lib/db/tickets.ts'));
const { listEquipment, createEquipment } = require(path.join(root, 'src/lib/db/equipment.ts'));
const { listStockItems, listStockTransactions } = require(path.join(root, 'src/lib/db/stock.ts'));
const { COMPANIES, COMPANY_LABEL, createBranch, listBranches, listBranchOptions, resolveBranch } = require(path.join(root, 'src/lib/db/branches.ts'));
const send = (body, key = 'local-test-key') => POST(new Request('http://localhost/api/internal/tickets', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': key }, body: JSON.stringify(body),
}));
after(() => { process.chdir(root); fs.rmSync(tmp, { recursive: true, force: true }); });

test('rejects unauthorized and malformed payloads without creating cases', async () => {
  const before = listTickets().length;
  assert.equal((await send({}, 'wrong')).status, 401);
  for (const body of [null, [], { type: 'repair', requester_name: 3 }, { type: 'repair', requester_name: 'Test', items: [null] }]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal(listTickets().length, before);
});

for (const type of ['repair', 'withdraw', 'return', 'it_service']) {
  test(`persists ${type} details and retries without duplicate tickets or stock movements`, async () => {
    const stock = listStockItems()[0];
    const payload = { type, request_id: `test-${type}`, requester_name: 'Tester', requester_department: 'IT',
      location: 'HQ', initial_message: 'Original issue', description: 'Additional detail', line_user_id: 'Utest',
      items: [{ name: stock.name, qty: 1 }], image_urls: ['/uploads/tickets/test.jpg', 'https://invalid.test/tracker'] };
    const response = await send(payload);
    assert.equal(response.status, 200);
    const result = await response.json();
    const ticket = listTickets().find(t => t.id === result.id);
    assert.equal(ticket.description, 'Original issue\n\nAdditional detail');
    assert.equal(ticket.meta.requester_department, 'IT');
    assert.deepEqual(ticket.meta.image_urls, ['/uploads/tickets/test.jpg']);
    const count = listTickets().length;
    const transactions = listStockTransactions().length;
    const retry = await (await send(payload)).json();
    assert.equal(retry.id, result.id);
    assert.equal(retry.duplicate, true);
    assert.equal(listTickets().length, count);
    assert.equal(listStockTransactions().length, transactions);
  });
}

test('preserves the selected equipment when asset codes are duplicated', async () => {
  const first = listEquipment()[0];
  const second = createEquipment({ ...first, brand_model: 'Second machine' });
  const payload = { type: 'repair', requester_name: 'Tester', asset_code: first.asset_code, equipment_id: second.id };
  const result = await (await send(payload)).json();
  assert.equal(listTickets().find(t => t.id === result.id).equipment_id, second.id);
  const ambiguous = await (await send({ ...payload, equipment_id: null })).json();
  assert.equal(listTickets().find(t => t.id === ambiguous.id).equipment_id, null);
});

test('seeds every company with its branches and keeps names unique per company', () => {
  assert.deepEqual(COMPANIES.map(c => c.code), ['montipa', 'motta', 'central']);
  for (const company of COMPANIES) {
    const branches = listBranches(company.code);
    assert.ok(branches.length > 0, `${company.code} ต้องมีสาขาอย่างน้อย 1 สาขา`);
    const names = branches.map(b => b.name);
    assert.equal(new Set(names).size, names.length, `${company.code} มีชื่อสาขาซ้ำกันเอง`);
  }
  // สาขาของคนละบริษัทต้องไม่ถูกคืนมาปนกัน — เป็นหัวใจของการแยกบริษัททั้งหมด
  assert.ok(listBranches('motta').every(b => b.company === 'motta'));
});

test('displays headquarters for the existing central company throughout branch selection', () => {
  assert.equal(COMPANIES.find(c => c.code === 'central').name, 'สำนักงานใหญ่');
  assert.equal(COMPANY_LABEL.central, 'สำนักงานใหญ่');
  const choice = listBranchOptions({ level: 'company' }).options.find(o => o.value === 'central');
  assert.equal(choice.label, 'สำนักงานใหญ่');
  assert.ok(choice.count > 0);
  assert.equal(resolveBranch('สำนักงานใหญ่').company, 'central');
  assert.equal(resolveBranch('สำนักงานใหญ่').companyLabel, 'สำนักงานใหญ่');
});

test('stores the reporting company and rejects a branch that belongs to another one', async () => {
  const montipa = listBranches('montipa')[0];
  const motta = listBranches('motta')[0];

  const ok = await send({ type: 'repair', requester_name: 'Tester', company: 'montipa', location: montipa.name });
  assert.equal(ok.status, 200);
  const created = await ok.json();
  assert.equal(listTickets().find(t => t.id === created.id).company, 'montipa');

  // บริษัทที่ไม่มีอยู่จริง และสาขาที่อยู่คนละบริษัท ต้องถูกปฏิเสธทั้งคู่
  assert.equal((await send({ type: 'repair', requester_name: 'Tester', company: 'nope', location: montipa.name })).status, 400);
  assert.equal((await send({ type: 'repair', requester_name: 'Tester', company: 'montipa', location: motta.name })).status, 400);
});

test('infers the company from a branch name only when it is unambiguous', async () => {
  const unique = listBranches('motta').find(b => listBranches('montipa').every(m => m.name !== b.name));
  const inferred = await (await send({ type: 'repair', requester_name: 'Tester', location: unique.name })).json();
  assert.equal(listTickets().find(t => t.id === inferred.id).company, 'motta');

  // ชื่อสาขาเดียวกันอยู่ 2 บริษัท -> ต้องปล่อยว่าง ไม่ใช่หยิบบริษัทแรกมาใส่เงียบๆ
  const shared = 'สาขาทดสอบชื่อซ้ำ';
  createBranch({ company: 'montipa', name: shared });
  createBranch({ company: 'motta', name: shared });
  const ambiguous = await (await send({ type: 'repair', requester_name: 'Tester', location: shared })).json();
  assert.equal(listTickets().find(t => t.id === ambiguous.id).company, null);
});

test('public webhook forwards the original signed body and reports bot failures', async () => {
  const { createHmac } = require('node:crypto');
  const { POST: webhook } = require(path.join(root, 'src/app/api/line/webhook/route.ts'));
  process.env.LINE_CHANNEL_SECRET = 'test-secret';
  process.env.LINE_BOT_WEBHOOK_URL = 'http://bot:8000/webhook';
  const raw = '{ "events": [] }';
  const signature = createHmac('sha256', 'test-secret').update(raw).digest('base64');
  const request = (sig = signature) => new Request('http://localhost/api/line/webhook', {
    method: 'POST', body: raw, headers: { 'x-line-signature': sig },
  });
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'http://bot:8000/webhook');
      assert.equal(options.body, raw);
      assert.equal(options.headers['x-line-signature'], signature);
      return new Response('{}', { status: 200 });
    };
    assert.equal((await webhook(request('invalid'))).status, 401);
    assert.equal(calls, 0);
    assert.equal((await webhook(request())).status, 200);
    assert.equal(calls, 1);
    global.fetch = async () => new Response('{}', { status: 500 });
    assert.equal((await webhook(request())).status, 503);
  } finally { global.fetch = originalFetch; }
});

test('branch edits persist and disabled branches disappear from intake menus without losing history', () => {
  const db = require(path.join(root, 'src/lib/db/branches.ts'));
  const branch = db.createBranch({ company: 'central', name: 'Temporary branch', group: 'Test group' });
  db.updateBranch(branch.id, { name: 'Renamed branch' });
  assert.equal(db.getBranchById(branch.id).name, 'Renamed branch');
  assert.equal(db.findBranchesByName('Renamedbranch', 'central')[0].id, branch.id);
  assert.ok(db.listBranchOptions({ level: 'branch', company: 'central', group: 'Test group' }).options.some(o => o.value === 'Renamed branch'));
  db.deactivateBranch(branch.id);
  assert.ok(!db.listBranches().some(b => b.id === branch.id));
  assert.equal(db.resolveBranch('Renamed branch').company, 'central');
  assert.equal(db.listBranchOptions({ level: 'branch', company: 'central', group: 'Test group' }).total, 0);
  db.activateBranch(branch.id);
  assert.ok(db.listBranches().some(b => b.id === branch.id));
  assert.equal(db.deleteBranch(branch.id), true);
  assert.equal(db.getBranchById(branch.id), null);
});

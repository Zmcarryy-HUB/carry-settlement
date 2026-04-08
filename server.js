const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'carry.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(DB_PATH)) require('./setup');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/api/settings', (_, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const o = {}; rows.forEach(r => o[r.key] = r.value);
  res.json(o);
});
app.put('/api/settings', (req, res) => {
  const up = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  db.transaction(() => Object.entries(req.body).forEach(([k, v]) => up.run(k, String(v))))();
  res.json({ ok: 1 });
});

app.get('/api/workers', (_, res) => res.json(db.prepare('SELECT * FROM workers WHERE is_active=1 ORDER BY sort_order,id').all()));
app.post('/api/workers', (req, res) => {
  const { name, payment_method, daily_rate } = req.body;
  const mx = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 as n FROM workers').get().n;
  const r = db.prepare('INSERT INTO workers (name,payment_method,daily_rate,sort_order) VALUES (?,?,?,?)').run(name, payment_method || 'transfer', daily_rate ?? 150000, mx);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/workers/:id', (req, res) => {
  const { name, payment_method, daily_rate, is_active } = req.body;
  db.prepare('UPDATE workers SET name=COALESCE(?,name),payment_method=COALESCE(?,payment_method),daily_rate=COALESCE(?,daily_rate),is_active=COALESCE(?,is_active) WHERE id=?')
    .run(name ?? null, payment_method ?? null, daily_rate ?? null, is_active ?? null, req.params.id);
  res.json({ ok: 1 });
});
app.delete('/api/workers/:id', (req, res) => { db.prepare('UPDATE workers SET is_active=0 WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });

app.get('/api/vehicles', (_, res) => res.json(db.prepare('SELECT * FROM vehicles WHERE is_active=1 ORDER BY sort_order,id').all()));
app.post('/api/vehicles', (req, res) => {
  const { name, plate, fuel_efficiency } = req.body;
  const mx = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 as n FROM vehicles').get().n;
  const r = db.prepare('INSERT INTO vehicles (name,plate,fuel_efficiency,sort_order) VALUES (?,?,?,?)').run(name, plate || '', fuel_efficiency ?? 9, mx);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/vehicles/:id', (req, res) => {
  const { name, plate, fuel_efficiency, is_active } = req.body;
  db.prepare('UPDATE vehicles SET name=COALESCE(?,name),plate=COALESCE(?,plate),fuel_efficiency=COALESCE(?,fuel_efficiency),is_active=COALESCE(?,is_active) WHERE id=?')
    .run(name ?? null, plate ?? null, fuel_efficiency ?? null, is_active ?? null, req.params.id);
  res.json({ ok: 1 });
});
app.delete('/api/vehicles/:id', (req, res) => { db.prepare('UPDATE vehicles SET is_active=0 WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });

const attachSub = (s) => {
  s.workers = db.prepare('SELECT * FROM site_workers WHERE site_id=?').all(s.id);
  s.vehicles = db.prepare('SELECT * FROM site_vehicles WHERE site_id=?').all(s.id);
  s.expenses = db.prepare('SELECT * FROM site_expenses WHERE site_id=?').all(s.id);
  return s;
};

app.get('/api/sites', (req, res) => {
  const m = req.query.month;
  const rows = m
    ? db.prepare("SELECT * FROM sites WHERE strftime('%Y-%m',date)=? ORDER BY date DESC,id DESC").all(m)
    : db.prepare('SELECT * FROM sites ORDER BY date DESC,id DESC LIMIT 200').all();
  res.json(rows.map(attachSub));
});

app.get('/api/sites/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(attachSub(s));
});

app.post('/api/sites', (req, res) => {
  const d = req.body;
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO sites (date,client_name,service_type,origin,destination,contract_amount,balance_amount,collection_status,payment_status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(d.date, d.client_name || '', d.service_type || '', d.origin || '', d.destination || '', d.contract_amount || 0, d.balance_amount || 0, d.collection_status || 'unpaid', d.payment_status || 'unpaid', d.notes || '');
    const sid = r.lastInsertRowid;
    insertSub(sid, d);
    return sid;
  })();
  res.json({ id });
});

app.put('/api/sites/:id', (req, res) => {
  const d = req.body; const sid = +req.params.id;
  db.transaction(() => {
    db.prepare('UPDATE sites SET date=?,client_name=?,service_type=?,origin=?,destination=?,contract_amount=?,balance_amount=?,collection_status=?,payment_status=?,notes=? WHERE id=?')
      .run(d.date, d.client_name || '', d.service_type || '', d.origin || '', d.destination || '', d.contract_amount || 0, d.balance_amount || 0, d.collection_status || 'unpaid', d.payment_status || 'unpaid', d.notes || '', sid);
    db.prepare('DELETE FROM site_workers WHERE site_id=?').run(sid);
    db.prepare('DELETE FROM site_vehicles WHERE site_id=?').run(sid);
    db.prepare('DELETE FROM site_expenses WHERE site_id=?').run(sid);
    insertSub(sid, d);
  })();
  res.json({ ok: 1 });
});

app.delete('/api/sites/:id', (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM site_workers WHERE site_id=?').run(req.params.id);
    db.prepare('DELETE FROM site_vehicles WHERE site_id=?').run(req.params.id);
    db.prepare('DELETE FROM site_expenses WHERE site_id=?').run(req.params.id);
    db.prepare('DELETE FROM sites WHERE id=?').run(req.params.id);
  })();
  res.json({ ok: 1 });
});

function insertSub(sid, d) {
  if (d.workers?.length) {
    const ins = db.prepare('INSERT INTO site_workers (site_id,worker_name,daily_rate,additional_pay,payment_method) VALUES (?,?,?,?,?)');
    d.workers.forEach(w => ins.run(sid, w.worker_name, w.daily_rate || 0, w.additional_pay || 0, w.payment_method || 'cash'));
  }
  if (d.vehicles?.length) {
    const ins = db.prepare('INSERT INTO site_vehicles (site_id,vehicle_name,plate,vehicle_cost,distance_km,fuel_cost) VALUES (?,?,?,?,?,?)');
    d.vehicles.forEach(v => ins.run(sid, v.vehicle_name, v.plate || '', v.vehicle_cost || 0, v.distance_km || 0, v.fuel_cost || 0));
  }
  if (d.expenses?.length) {
    const ins = db.prepare('INSERT INTO site_expenses (site_id,category,amount,note) VALUES (?,?,?,?)');
    d.expenses.forEach(e => ins.run(sid, e.category, e.amount || 0, e.note || ''));
  }
}

app.get('/api/expenses', (req, res) => {
  const { type, month } = req.query;
  let rows;
  if (type === 'regular' && month) rows = db.prepare("SELECT * FROM expenses WHERE type='regular' AND month=? ORDER BY category,id").all(month);
  else if (type && month) rows = db.prepare("SELECT * FROM expenses WHERE type=? AND substr(date,1,7)=? ORDER BY date DESC,id DESC").all(type, month);
  else if (type) rows = db.prepare('SELECT * FROM expenses WHERE type=? ORDER BY id DESC').all(type);
  else rows = db.prepare('SELECT * FROM expenses ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/expenses', (req, res) => {
  const d = req.body;
  const r = db.prepare('INSERT INTO expenses (type,month,date,category,item,amount,note,is_checked) VALUES (?,?,?,?,?,?,?,?)')
    .run(d.type, d.month || '', d.date || '', d.category || '', d.item || '', d.amount || 0, d.note || '', d.is_checked || 0);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/expenses/:id', (req, res) => {
  const d = req.body;
  const fields = []; const vals = [];
  for (const k of ['type', 'month', 'date', 'category', 'item', 'amount', 'note', 'is_checked']) {
    if (d[k] !== undefined) { fields.push(`${k}=?`); vals.push(d[k]); }
  }
  if (fields.length) { vals.push(req.params.id); db.prepare(`UPDATE expenses SET ${fields.join(',')} WHERE id=?`).run(...vals); }
  res.json({ ok: 1 });
});

app.delete('/api/expenses/:id', (req, res) => { db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });

app.get('/api/report', (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });

  const sites = db.prepare("SELECT * FROM sites WHERE strftime('%Y-%m',date)=?").all(month);
  let totalIncome = 0, totalWorkerCost = 0, totalAdditionalPay = 0, totalVehicleCost = 0, totalFuelCost = 0, totalSiteExp = 0;
  const incomeByType = {};
  const collection = { paid: 0, unpaid: 0 };
  const payment = { paid: 0, unpaid: 0 };

  sites.forEach(s => {
    const income = (s.contract_amount || 0) + (s.balance_amount || 0);
    totalIncome += income;
    const t = s.service_type || '기타';
    incomeByType[t] = (incomeByType[t] || 0) + income;
    collection[s.collection_status === 'paid' ? 'paid' : 'unpaid'] += income;

    const ws = db.prepare('SELECT * FROM site_workers WHERE site_id=?').all(s.id);
    const vs = db.prepare('SELECT * FROM site_vehicles WHERE site_id=?').all(s.id);
    const es = db.prepare('SELECT * FROM site_expenses WHERE site_id=?').all(s.id);

    let sitePay = 0;
    ws.forEach(w => { totalWorkerCost += w.daily_rate || 0; totalAdditionalPay += w.additional_pay || 0; sitePay += (w.daily_rate || 0) + (w.additional_pay || 0); });
    vs.forEach(v => { totalVehicleCost += v.vehicle_cost || 0; totalFuelCost += v.fuel_cost || 0; });
    es.forEach(e => { totalSiteExp += e.amount || 0; });

    payment[s.payment_status === 'paid' ? 'paid' : 'unpaid'] += sitePay;
  });

  const regular = db.prepare("SELECT category, SUM(amount) as total FROM expenses WHERE type='regular' AND month=? GROUP BY category").all(month);
  const irregular = db.prepare("SELECT category, SUM(amount) as total FROM expenses WHERE type='irregular' AND substr(date,1,7)=? GROUP BY category").all(month);
  const business = db.prepare("SELECT category, SUM(amount) as total FROM expenses WHERE type='business' AND substr(date,1,7)=? GROUP BY category").all(month);
  const sumArr = arr => arr.reduce((a, b) => a + b.total, 0);

  const siteCostTotal = totalWorkerCost + totalAdditionalPay + totalVehicleCost + totalFuelCost + totalSiteExp;
  const expTotal = sumArr(regular) + sumArr(irregular) + sumArr(business);

  res.json({
    month, siteCount: sites.length, totalIncome, incomeByType,
    siteCosts: { workerCost: totalWorkerCost, additionalPay: totalAdditionalPay, vehicleCost: totalVehicleCost, fuelCost: totalFuelCost, siteExpense: totalSiteExp, total: siteCostTotal },
    expenses: {
      regular: { items: regular, total: sumArr(regular) },
      irregular: { items: irregular, total: sumArr(irregular) },
      business: { items: business, total: sumArr(business) },
      total: expTotal
    },
    netProfit: totalIncome - siteCostTotal - expTotal,
    collection, payment
  });
});

app.get('/api/backup', (_, res) => {
  const data = {
    version: 1, timestamp: new Date().toISOString(),
    settings: db.prepare('SELECT * FROM settings').all(),
    workers: db.prepare('SELECT * FROM workers').all(),
    vehicles: db.prepare('SELECT * FROM vehicles').all(),
    sites: db.prepare('SELECT * FROM sites').all(),
    site_workers: db.prepare('SELECT * FROM site_workers').all(),
    site_vehicles: db.prepare('SELECT * FROM site_vehicles').all(),
    site_expenses: db.prepare('SELECT * FROM site_expenses').all(),
    expenses: db.prepare('SELECT * FROM expenses').all()
  };
  res.setHeader('Content-Disposition', `attachment; filename=carry-backup-${data.timestamp.slice(0, 10)}.json`);
  res.json(data);
});

app.post('/api/restore', upload.single('file'), (req, res) => {
  try {
    const data = req.file ? JSON.parse(req.file.buffer.toString()) : req.body;
    if (!data.version) return res.status(400).json({ error: 'Invalid backup file' });
    db.transaction(() => {
      db.exec('DELETE FROM site_expenses;DELETE FROM site_vehicles;DELETE FROM site_workers;DELETE FROM sites;DELETE FROM expenses;DELETE FROM workers;DELETE FROM vehicles;DELETE FROM settings;');
      const tables = {
        settings: ['key', 'value'],
        workers: ['id', 'name', 'payment_method', 'daily_rate', 'is_active', 'sort_order'],
        vehicles: ['id', 'name', 'plate', 'fuel_efficiency', 'is_active', 'sort_order'],
        sites: ['id', 'date', 'client_name', 'service_type', 'origin', 'destination', 'contract_amount', 'balance_amount', 'collection_status', 'payment_status', 'notes', 'created_at'],
        site_workers: ['id', 'site_id', 'worker_name', 'daily_rate', 'additional_pay', 'payment_method'],
        site_vehicles: ['id', 'site_id', 'vehicle_name', 'plate', 'vehicle_cost', 'distance_km', 'fuel_cost'],
        site_expenses: ['id', 'site_id', 'category', 'amount', 'note'],
        expenses: ['id', 'type', 'month', 'date', 'category', 'item', 'amount', 'note', 'is_checked', 'created_at']
      };
      for (const [tbl, cols] of Object.entries(tables)) {
        if (!data[tbl]?.length) continue;
        const ins = db.prepare(`INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        data[tbl].forEach(r => ins.run(...cols.map(c => r[c] ?? null)));
      }
    })();
    res.json({ ok: 1 });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/export', async (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });
  const wb = new ExcelJS.Workbook();

  const ws1 = wb.addWorksheet('현장내역');
  ws1.columns = [
    { header: '날짜', key: 'date', width: 12 }, { header: '고객명', key: 'client', width: 14 },
    { header: '유형', key: 'type', width: 14 }, { header: '출발지', key: 'origin', width: 14 },
    { header: '도착지', key: 'dest', width: 14 }, { header: '계약금', key: 'contract', width: 14 },
    { header: '잔금', key: 'balance', width: 14 }, { header: '합계', key: 'total', width: 14 },
    { header: '수금', key: 'coll', width: 10 }, { header: '인건비', key: 'labor', width: 14 },
    { header: '차량비', key: 'vehicle', width: 14 }, { header: '유류비', key: 'fuel', width: 14 },
    { header: '부대비용', key: 'misc', width: 14 }, { header: '지급', key: 'pay', width: 10 },
    { header: '비고', key: 'notes', width: 18 },
  ];
  const sites = db.prepare("SELECT * FROM sites WHERE strftime('%Y-%m',date)=? ORDER BY date").all(month);
  sites.forEach(s => {
    const w2 = db.prepare('SELECT * FROM site_workers WHERE site_id=?').all(s.id);
    const vs = db.prepare('SELECT * FROM site_vehicles WHERE site_id=?').all(s.id);
    const es = db.prepare('SELECT * FROM site_expenses WHERE site_id=?').all(s.id);
    ws1.addRow({
      date: s.date, client: s.client_name, type: s.service_type, origin: s.origin, dest: s.destination,
      contract: s.contract_amount, balance: s.balance_amount, total: (s.contract_amount || 0) + (s.balance_amount || 0),
      coll: s.collection_status === 'paid' ? '수금완료' : '미수금',
      labor: w2.reduce((a, w) => a + (w.daily_rate || 0) + (w.additional_pay || 0), 0),
      vehicle: vs.reduce((a, v) => a + (v.vehicle_cost || 0), 0),
      fuel: vs.reduce((a, v) => a + (v.fuel_cost || 0), 0),
      misc: es.reduce((a, e) => a + (e.amount || 0), 0),
      pay: s.payment_status === 'paid' ? '지급완료' : '미지급', notes: s.notes
    });
  });

  const ws3 = wb.addWorksheet('경비내역');
  ws3.columns = [
    { header: '구분', key: 'type', width: 12 }, { header: '날짜', key: 'date', width: 12 },
    { header: '카테고리', key: 'cat', width: 14 }, { header: '항목', key: 'item', width: 18 },
    { header: '금액', key: 'amount', width: 14 }, { header: '비고', key: 'note', width: 18 },
  ];
  const typeLabel = { regular: '정기지출', irregular: '비정기지출', business: '사업비지출' };
  db.prepare("SELECT * FROM expenses WHERE (type='regular' AND month=?) OR (type IN ('irregular','business') AND substr(date,1,7)=?) ORDER BY type,date").all(month, month)
    .forEach(e => ws3.addRow({ type: typeLabel[e.type], date: e.type === 'regular' ? e.month : e.date, cat: e.category, item: e.item, amount: e.amount, note: e.note }));

  [ws1, ws3].forEach(ws => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } }; ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=carry-${month}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`캐리 현장정산 on port ${PORT}`));

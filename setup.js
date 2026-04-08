const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'carry.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payment_method TEXT DEFAULT 'transfer',
    daily_rate INTEGER DEFAULT 150000,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plate TEXT DEFAULT '',
    fuel_efficiency REAL DEFAULT 9,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    client_name TEXT DEFAULT '',
    service_type TEXT DEFAULT '',
    origin TEXT DEFAULT '',
    destination TEXT DEFAULT '',
    contract_amount INTEGER DEFAULT 0,
    balance_amount INTEGER DEFAULT 0,
    collection_status TEXT DEFAULT 'unpaid',
    payment_status TEXT DEFAULT 'unpaid',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS site_workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    worker_name TEXT NOT NULL,
    daily_rate INTEGER DEFAULT 0,
    additional_pay INTEGER DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS site_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    vehicle_name TEXT NOT NULL,
    plate TEXT DEFAULT '',
    vehicle_cost INTEGER DEFAULT 0,
    distance_km REAL DEFAULT 0,
    fuel_cost INTEGER DEFAULT 0,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS site_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    month TEXT DEFAULT '',
    date TEXT DEFAULT '',
    category TEXT DEFAULT '',
    item TEXT DEFAULT '',
    amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    is_checked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_sites_date ON sites(date);
  CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses(type, month);
`);

const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
upsert.run('diesel_price', '1940');
upsert.run('default_fuel_efficiency', '9');
upsert.run('base_location', '의정부 호원동');

const chk = db.prepare('SELECT COUNT(*) as c FROM workers');
if (chk.get().c === 0) {
  const ins = db.prepare('INSERT INTO workers (name, payment_method, daily_rate, sort_order) VALUES (?,?,?,?)');
  const ws = [
    ['한이석', 'cash', 0, 1],
    ['최지수', 'transfer', 150000, 2],
    ['혁', 'transfer', 150000, 3],
    ['만수', 'transfer', 150000, 4],
    ['김종인', 'transfer', 150000, 5],
    ['조성란', 'transfer', 150000, 6],
    ['박석준', 'transfer', 150000, 7],
    ['방경자', 'transfer', 150000, 8],
  ];
  ws.forEach(w => ins.run(...w));
}

const chkV = db.prepare('SELECT COUNT(*) as c FROM vehicles');
if (chkV.get().c === 0) {
  const ins = db.prepare('INSERT INTO vehicles (name, plate, fuel_efficiency, sort_order) VALUES (?,?,?,?)');
  ins.run('5톤1호', '서울84사2357', 8, 1);
  ins.run('5톤2호', '경기90자2039', 8, 2);
  ins.run('용달', '서울87자4110', 9, 3);
}

console.log('DB 초기화 완료:', DB_PATH);
db.close();

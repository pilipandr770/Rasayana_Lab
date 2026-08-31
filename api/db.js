// Простое файловое хранилище (JSON) — достаточно для объёма демо-проекта,
// без native-зависимостей, которые бывают проблемны в alpine-контейнерах.
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      leads: [], orders: [],
      settings: { openTier: 0, socialLinks: { telegram: "", twitter: "", instagram: "" } },
    }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let nextId = 1;
function newId() {
  const db = readDb();
  const maxLead = db.leads.reduce((m, l) => Math.max(m, l.id), 0);
  const maxOrder = db.orders.reduce((m, o) => Math.max(m, o.id), 0);
  return Math.max(maxLead, maxOrder, nextId++) + 1;
}

function addLead(lead) {
  const db = readDb();
  const entry = { id: newId(), createdAt: new Date().toISOString(), ...lead };
  db.leads.push(entry);
  writeDb(db);
  return entry;
}

function getLeads() {
  return readDb().leads;
}

function findLeadByWallet(wallet) {
  return readDb().leads.find((l) => l.wallet.toLowerCase() === wallet.toLowerCase());
}

function addOrder(order) {
  const db = readDb();
  const entry = { id: newId(), createdAt: new Date().toISOString(), status: "pending", ...order };
  db.orders.push(entry);
  writeDb(db);
  return entry;
}

function updateOrderBySessionId(sessionId, patch) {
  const db = readDb();
  const order = db.orders.find((o) => o.stripeSessionId === sessionId);
  if (!order) return null;
  Object.assign(order, patch);
  writeDb(db);
  return order;
}

function updateOrderById(id, patch) {
  const db = readDb();
  const order = db.orders.find((o) => o.id === Number(id));
  if (!order) return null;
  Object.assign(order, patch);
  writeDb(db);
  return order;
}

function getOrders() {
  return readDb().orders;
}

function getOrdersByWallet(wallet) {
  return readDb().orders.filter((o) => (o.wallet || "").toLowerCase() === wallet.toLowerCase());
}

function getSetting(key) {
  return readDb().settings[key];
}

function setSetting(key, value) {
  const db = readDb();
  db.settings[key] = value;
  writeDb(db);
  return value;
}

module.exports = {
  addLead, getLeads, findLeadByWallet,
  addOrder, updateOrderBySessionId, updateOrderById, getOrders, getOrdersByWallet,
  getSetting, setSetting,
};

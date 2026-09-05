const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Stripe = require("stripe");
const { ethers } = require("ethers");
const membershipAbi = require("./membership_abi.json");
const db = require("./db");
const CHATBOT_SYSTEM_PROMPT = require("./chatbot_knowledge");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(cors());

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0xFEa77eAf7bE46ec845801eAE93dE6d156e223d49";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function getContractWithSigner() {
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  return new ethers.Contract(CONTRACT_ADDRESS, membershipAbi, wallet);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// --- Telegram Login Widget: проверка подписи данных, присланных фронтендом ---
// https://core.telegram.org/widgets/login#checking-authorization
function verifyTelegramAuth(data) {
  if (!data || !data.hash || !process.env.TELEGRAM_BOT_TOKEN) return false;
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secretKey = crypto.createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");
  if (hmac !== hash) return false;
  const authDate = Number(rest.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return false; // старше суток — отклоняем
  return true;
}

// --- Telegram Bot API: реально ли этот user_id состоит в канале проекта ---
async function checkTelegramMembership(userId) {
  const channel = process.env.TELEGRAM_CHANNEL_USERNAME;
  if (!process.env.TELEGRAM_BOT_TOKEN || !channel) return false;
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) return false;
    return ["creator", "administrator", "member"].includes(data.result.status);
  } catch (e) {
    console.error("telegram membership check failed:", e.message);
    return false;
  }
}

// --- Telegram Bot API: отправить сообщение основателю в личку (уведомление о новой заявке) ---
async function sendTelegramAdminMessage(text) {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await resp.json();
    if (!data.ok) console.error("telegram sendMessage failed:", data.description);
    return data.ok === true;
  } catch (e) {
    console.error("telegram sendMessage error:", e.message);
    return false;
  }
}

// --- Instagram: делегируем проверку внутреннему instagrapi-сервису ---
// configured=false означает "ещё не настроено" (например, запасной аккаунт не подключён) —
// это НЕ то же самое, что "проверили и не подписан". Пока не настроено, шаг мягкий и не блокирует заявку;
// как только ig-checker залогинится, проверка становится настоящей автоматически, без правок кода.
async function checkInstagramFollow(username) {
  const base = process.env.IG_CHECKER_URL;
  if (!base) return { configured: false, verified: false, reason: "ig-checker not configured" };
  try {
    const healthResp = await fetch(`${base}/health`);
    const health = await healthResp.json().catch(() => ({}));
    if (!health.logged_in) return { configured: false, verified: false, reason: "ig-checker not logged in yet" };

    const resp = await fetch(`${base}/check-follow?username=${encodeURIComponent(username)}`, {
      headers: { "X-Internal-Secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!resp.ok) return { configured: true, verified: false, reason: "check failed" };
    const data = await resp.json();
    return { configured: true, verified: !!data.verified, reason: data.reason };
  } catch (e) {
    console.error("instagram check failed:", e.message);
    return { configured: false, verified: false, reason: "ig-checker unreachable" };
  }
}

// --- Stripe webhook: должен получать СЫРОЕ тело для проверки подписи,
// поэтому подключается ДО глобального express.json() ---
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const shipping = session.shipping_details || session.customer_details;
    db.updateOrderBySessionId(session.id, {
      status: "paid",
      customerEmail: session.customer_details?.email || null,
      shippingName: shipping?.name || null,
      shippingAddress: shipping?.address ? JSON.stringify(shipping.address) : null,
    });
    console.log("Order marked paid for session", session.id);
  }
  res.json({ received: true });
});

app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Checkout ---
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { productId, price, name, wallet } = req.body || {};
    const amount = Number(price);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "invalid price" });
    }
    const origin = req.headers.origin || "https://rasayana.andrii-it.de";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "DE", "FR", "UA", "PL", "NL", "ES", "IT"] },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: name || productId || "Rasayana product (test)" },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/account.html?success=1`,
      cancel_url: `${origin}/shop.html?canceled=1`,
    });

    db.addOrder({
      wallet: wallet || null,
      productId,
      productName: name || productId,
      amount,
      currency: "usd",
      stripeSessionId: session.id,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Личный кабинет: заказы по кошельку ---
app.get("/api/orders", (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  res.json(db.getOrdersByWallet(wallet));
});

// --- Очередь / приоритет доступа ---
app.get("/api/settings/open-tier", (req, res) => {
  res.json({ openTier: db.getSetting("openTier") ?? 0 });
});

// --- AML-порог для купівлі токена: сума в POL, вище якої онлайн-покупка
// блокується на фронтенді до впровадження повної ідентифікаційної перевірки
// (див. compliance-service у AML-18). За замовчуванням — грубий еквівалент
// орієнтиру EBA у €1000 на момент налаштування; курс POL/EUR не стежиться
// автоматично, адмін оновлює вручну при істотній зміні ціни POL. ---
app.get("/api/settings/aml-threshold", (req, res) => {
  res.json({ thresholdPol: db.getSetting("amlThresholdPol") ?? 11500 });
});
app.post("/api/admin/settings/aml-threshold", requireAdmin, (req, res) => {
  const thresholdPol = Number(req.body?.thresholdPol);
  if (!Number.isFinite(thresholdPol) || thresholdPol <= 0) {
    return res.status(400).json({ error: "thresholdPol must be a positive number" });
  }
  db.setSetting("amlThresholdPol", thresholdPol);
  res.json({ thresholdPol });
});

// --- Соцсети (управляются из админки, показываются в хедере) ---
app.get("/api/settings/social-links", (req, res) => {
  res.json(db.getSetting("socialLinks") || { telegram: "", twitter: "", instagram: "" });
});
app.post("/api/admin/settings/social-links", requireAdmin, (req, res) => {
  const { telegram, twitter, instagram } = req.body || {};
  const value = { telegram: telegram || "", twitter: twitter || "", instagram: instagram || "" };
  db.setSetting("socialLinks", value);
  res.json(value);
});

// --- Чек-лист действий основателя (из премортем-анализа) ---
// Смысл: держать неудобные внешние действия (RFQ, звонки, встречи) на виду
// там, куда основатель и так заходит каждый день. Storage — одна настройка,
// клиент присылает весь массив целиком (один админ, конфликтов нет).
const DEFAULT_CHECKLIST = [
  { id: "rfq_cyclo", group: "Сировина (RFQ)", title: "Запит ціни: цикластрагенол — 3 постачальники", hint: "Ціни в дорожній карті — з публічних лістингів, не котирування.", done: false, doneAt: null, note: "" },
  { id: "rfq_sperm", group: "Сировина (RFQ)", title: "Запит ціни: спермідин (екстракт зародків пшениці) — 3 постачальники", hint: "Уточнити стандартизацію (0.2 / 0.5 / 1%) — від неї залежить розмір дози й ліміт ЄС 6 мг/день.", done: false, doneAt: null, note: "" },
  { id: "rfq_amla", group: "Сировина (RFQ)", title: "Запит ціни: амла / галова кислота — 2 постачальники", hint: "Найдешевший компонент, але потрібен для повної собівартості.", done: false, doneAt: null, note: "" },

  { id: "pet_list", group: "Швидкий трек: корми для тварин", title: "Скласти список 10 виробників кормів/добавок для тварин у ЄС", hint: "Найкоротший шлях до грошей у всьому проєкті.", done: false, doneAt: null, note: "" },
  { id: "pet_first", group: "Швидкий трек: корми для тварин", title: "Надіслати першу пропозицію постачання спермідину як інгредієнта", hint: "Без Novel Food, без бренду, без CAC — регуляторну відповідальність несе партнер.", done: false, doneAt: null, note: "" },
  { id: "pet_five", group: "Швидкий трек: корми для тварин", title: "Дійти до 5 надісланих пропозицій", hint: "Одна відповідь із п'яти — нормальна конверсія холодного B2B.", done: false, doneAt: null, note: "" },
  { id: "pet_reply", group: "Швидкий трек: корми для тварин", title: "Отримати першу відповідь або дзвінок", hint: "Це перший зовнішній сигнал, що трек живий.", done: false, doneAt: null, note: "" },

  { id: "sci_find", group: "Наукова перевірка", title: "Знайти comp-chem спеціаліста для розбору докінгу", hint: "Університет, LinkedIn або платна консультація на 1–2 години.", done: false, doneAt: null, note: "" },
  { id: "sci_review", group: "Наукова перевірка", title: "Розібрати: чи не артефакт збіг EP300 у всіх трьох кандидатів", hint: "Краще почути це від спеціаліста, ніж від інвестора.", done: false, doneAt: null, note: "" },
  { id: "sci_cro", group: "Наукова перевірка", title: "Запросити квоту в 2 CRO на in vitro валідацію", hint: "€30–80k у дорожній карті — оцінка, не котирування.", done: false, doneAt: null, note: "" },

  { id: "inv_first", group: "Інвестори", title: "Провести першу зустріч із ПОТОЧНИМ деком", hint: "Не з доопрацьованим. З тим, що є зараз.", done: false, doneAt: null, note: "" },
  { id: "inv_five", group: "Інвестори", title: "Дійти до 5 інвесторських контактів", hint: "Мета — не гроші, а п'ять разів почути заперечення.", done: false, doneAt: null, note: "" },

  { id: "reg_call", group: "Регуляторика", title: "Один вступний дзвінок з Novel Food консультантом", hint: "Більшість дають безкоштовну першу консультацію — перевірити оцінку €20–500k.", done: false, doneAt: null, note: "" },

  { id: "disc_nobuild", group: "Дисципліна", title: "Місяць без правок сайту", hint: "Сайт готовий. Подальші правки — це уникання дзвінків.", done: false, doneAt: null, note: "" },
];

app.get("/api/admin/checklist", requireAdmin, (req, res) => {
  res.json({ items: db.getSetting("checklist") || DEFAULT_CHECKLIST });
});
app.post("/api/admin/checklist", requireAdmin, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
  db.setSetting("checklist", items);
  res.json({ items });
});

// --- Airdrop с условиями (лид-форма) ---
// Telegram и Instagram проверяются по-настоящему (Bot API / instagrapi) прямо здесь;
// репост нельзя честно проверить автоматически ни на одной площадке, поэтому он
// уходит на ручную модерацию в админку — токен выдаётся только после approve.
app.post("/api/leads", async (req, res) => {
  try {
    const { wallet, email, telegramAuth, instagramUsername, repostProofUrl } = req.body || {};
    if (!wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "valid wallet address required" });
    }
    if (!email) {
      return res.status(400).json({ error: "email required" });
    }
    if (!repostProofUrl) {
      return res.status(400).json({ error: "repost_proof_required" });
    }
    const existing = db.findLeadByWallet(wallet);
    if (existing) {
      return res.status(409).json({ error: "this wallet already submitted the form" });
    }

    if (!telegramAuth || !telegramAuth.id) {
      return res.status(400).json({ error: "telegram_required" });
    }
    if (!verifyTelegramAuth(telegramAuth)) {
      return res.status(400).json({ error: "telegram_invalid_signature" });
    }
    const telegramMember = await checkTelegramMembership(telegramAuth.id);
    if (!telegramMember) {
      return res.status(400).json({ error: "telegram_not_subscribed" });
    }

    if (!instagramUsername) {
      return res.status(400).json({ error: "instagram_username_required" });
    }
    const igResult = await checkInstagramFollow(instagramUsername);
    if (igResult.configured && !igResult.verified) {
      return res.status(400).json({ error: "instagram_not_subscribed" });
    }

    const lead = db.addLead({
      wallet,
      email,
      telegramUserId: telegramAuth.id,
      telegramUsername: telegramAuth.username || null,
      telegramVerified: true,
      instagramUsername,
      instagramVerified: igResult.configured ? !!igResult.verified : "not_checked_yet",
      repostProofUrl,
      status: "pending_review",
    });

    res.json({ ok: true, lead });
  } catch (err) {
    console.error("leads error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Форма зв'язку ("What We Need" / ask.html) — падає одразу в Telegram засновника ---
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, role, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: "name, email and message are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "invalid email" });
    }
    const entry = db.addMessage({ name, email, role: role || null, message });

    const text = [
      "📩 <b>Нова заявка з ask.html</b>",
      `Ім'я: ${escapeHtml(name)}`,
      `Email: ${escapeHtml(email)}`,
      role ? `Роль: ${escapeHtml(role)}` : null,
      `Повідомлення: ${escapeHtml(message)}`,
    ].filter(Boolean).join("\n");
    sendTelegramAdminMessage(text).catch(() => {});

    res.json({ ok: true, id: entry.id });
  } catch (err) {
    console.error("contact error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- AI-чат-бот на сайті: пояснює проєкт і токен, спираючись лише на
// CHATBOT_SYSTEM_PROMPT (курировано вручну, без реальних назв речовин) ---
const CHATBOT_MODEL = process.env.CHATBOT_MODEL || "claude-haiku-4-5-20251001";
const CHATBOT_RATE_LIMIT_MAX = 20; // запитів
const CHATBOT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // за 10 хвилин
const chatbotRateLimits = new Map(); // ip -> { count, resetAt }

function checkChatbotRateLimit(ip) {
  const now = Date.now();
  const entry = chatbotRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    chatbotRateLimits.set(ip, { count: 1, resetAt: now + CHATBOT_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= CHATBOT_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "chatbot_not_configured" });
    }
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    if (!checkChatbotRateLimit(ip)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }
    // Обрізаємо історію й довжину повідомлень — контроль вартості й зловживань.
    const trimmed = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000),
    }));

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CHATBOT_MODEL,
        max_tokens: 500,
        system: CHATBOT_SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });
    const data = await anthropicResp.json();
    if (!anthropicResp.ok) {
      console.error("anthropic error:", data);
      return res.status(502).json({ error: "chatbot_upstream_error" });
    }
    const reply = data.content?.[0]?.text || "";
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Admin ---
app.get("/api/admin/messages", requireAdmin, (req, res) => res.json(db.getMessages()));
app.get("/api/admin/leads", requireAdmin, (req, res) => res.json(db.getLeads()));
app.post("/api/admin/leads/:id/approve", requireAdmin, async (req, res) => {
  try {
    const lead = db.getLeads().find((l) => l.id === Number(req.params.id));
    if (!lead) return res.status(404).json({ error: "not found" });
    if (lead.status === "granted") return res.json(lead);

    const contract = getContractWithSigner();
    const alreadyClaimed = await contract.hasClaimedFree(lead.wallet);
    if (!alreadyClaimed) {
      const tx = await contract.airdrop(lead.wallet);
      await tx.wait();
    }
    const updated = db.updateLeadById(lead.id, { status: "granted", approvedAt: new Date().toISOString() });
    res.json(updated);
  } catch (err) {
    console.error("approve lead error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/admin/orders", requireAdmin, (req, res) => res.json(db.getOrders()));
app.post("/api/admin/orders/:id/fulfill", requireAdmin, (req, res) => {
  const order = db.updateOrderById(req.params.id, { status: "fulfilled" });
  if (!order) return res.status(404).json({ error: "not found" });
  res.json(order);
});
app.post("/api/admin/settings/open-tier", requireAdmin, (req, res) => {
  const tier = Number(req.body?.openTier);
  if (Number.isNaN(tier) || tier < 0 || tier > 5) return res.status(400).json({ error: "openTier must be 0-5" });
  db.setSetting("openTier", tier);
  res.json({ openTier: tier });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Rasayana API listening on port ${port}`));

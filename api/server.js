const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { ethers } = require("ethers");
const membershipAbi = require("./membership_abi.json");
const db = require("./db");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(cors());

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x2eff941e36D62c54B754dbd099b5726A2b29f226";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function getContractWithSigner() {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  return new ethers.Contract(CONTRACT_ADDRESS, membershipAbi, wallet);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
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

// --- Airdrop с условиями (лид-форма) ---
app.post("/api/leads", async (req, res) => {
  try {
    const { wallet, email, subscribedTelegram, likedX, repostedX } = req.body || {};
    if (!wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "valid wallet address required" });
    }
    if (!email) {
      return res.status(400).json({ error: "email required" });
    }
    const existing = db.findLeadByWallet(wallet);
    if (existing) {
      return res.status(409).json({ error: "this wallet already submitted the form" });
    }

    const lead = db.addLead({ wallet, email, subscribedTelegram: !!subscribedTelegram, likedX: !!likedX, repostedX: !!repostedX });

    const contract = getContractWithSigner();
    const alreadyClaimed = await contract.hasClaimedFree(wallet);
    if (!alreadyClaimed) {
      const tx = await contract.airdrop(wallet);
      await tx.wait();
    }

    res.json({ ok: true, lead });
  } catch (err) {
    console.error("leads error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Admin ---
app.get("/api/admin/leads", requireAdmin, (req, res) => res.json(db.getLeads()));
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

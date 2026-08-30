const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { productId, price, name } = req.body || {};
    const amount = Number(price);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "invalid price" });
    }
    const origin = req.headers.origin || "https://rasayana.andrii-it.de";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
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
      success_url: `${origin}/shop.html?success=1`,
      cancel_url: `${origin}/shop.html?canceled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Rasayana API listening on port ${port}`));

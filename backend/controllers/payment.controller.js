import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import { stripe } from "../lib/stripe.js";
import Product from "../models/product.model.js";

console.log("CLIENT_URL:", process.env.CLIENT_URL);

// 🧾 Stripe Webhook Handler
export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await handleSuccessfulCheckout(session);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

// 💳 Create Checkout Session
export const createCheckoutSession = async (req, res) => {
  try {
    const { products, couponCode } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "Invalid or empty products array" });
    }

    let totalAmount = 0;

    const lineItems = products.map((product) => {
      const amount = Math.round(product.price * 100); // cents
      totalAmount += amount * product.quantity;

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
            images: [product.image],
          },
          unit_amount: amount,
        },
        quantity: product.quantity || 1,
      };
    });

	    const compactCart = products
      .map((p) => `${p._id || p.productId}:${p.quantity || 1}`)
      .join(";");

	   const metadataCart =
      compactCart.length <= 500 ? compactCart : products.map((p) => `${p._id || p.productId}`).join(";").slice(0, 500);

    // 🏷️ Proveri kupon ako postoji
    let coupon = null;
    if (couponCode) {
      coupon = await Coupon.findOne({ code: couponCode, userId: req.user._id, isActive: true });
      if (coupon) {
        totalAmount -= Math.round((totalAmount * coupon.discountPercentage) / 100);
      }
    }

    // 💰 Kreiraj Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: process.env.CLIENT_URL + "/purchase-success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: process.env.CLIENT_URL + "/cart",
      discounts: coupon
        ? [
            {
              coupon: await createStripeCoupon(coupon.discountPercentage),
            },
          ]
        : [],
      metadata: {
        userId: req.user?.id ? String(req.user.id) : "",
        cart: metadataCart,
        couponCode: couponCode || "",
      },
    });


    // 🎁 Ako korisnik potroši više od $200, dobija novi kupon
    if (totalAmount >= 20000) {
      await createNewCoupon(req.user._id);
    }

    res.status(200).json({ id: session.id, totalAmount: totalAmount / 100 });
  } catch (error) {
    console.error("Error processing checkout:", error);
    res.status(500).json({ message: "Error processing checkout", error: error.message });
  }
};

// ✅ Obrada uspešnog plaćanja
export const checkoutSuccess = async (req, res) => {
  try {
    const sessionId = req.body.sessionId || req.query.session_id;
    if (!sessionId) return res.status(400).json({ ok: false, message: "Missing session id" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    await handleSuccessfulCheckout(session);
    res.json({ success: true });
  } catch (error) {
    console.error("Error in checkout success:", error);
    res.status(500).json({ error: "Failed to process checkout success" });
  }
};

// 🧠 Pomoćna funkcija: Kada je checkout uspešan
async function handleSuccessfulCheckout(session) {
  try {
    if (session.payment_status !== "paid") return;

    // Deaktiviraj kupon ako je korišćen
    if (session.metadata?.couponCode) {
      await Coupon.findOneAndUpdate(
        { code: session.metadata.couponCode, userId: session.metadata.userId },
        { isActive: false }
      );
    }

    // Parse cart from metadata - support compact "id:qty;id2:qty2" or legacy JSON array
    const rawCart = session.metadata?.cart || "";
    let cartItems = [];

    if (!rawCart) {
      cartItems = [];
    } else if (rawCart.trim().startsWith("[")) {
      // legacy: full JSON array
      try {
        cartItems = JSON.parse(rawCart).map((p) => ({
          id: p._id || p.productId || p.id,
          q: p.quantity || p.qty || p.q || 1,
          price: p.price || p.unitPrice || p.pricePerUnit || undefined,
        }));
      } catch (e) {
        cartItems = [];
      }
    } else {
      // compact format "id:qty;id2:qty2"
      cartItems = rawCart
        .split(";")
        .map((s) => {
          const [id, q] = s.split(":");
          if (!id) return null;
          return { id: id.trim(), q: Number(q || 1) };
        })
        .filter(Boolean);
    }

    const productIds = [...new Set(cartItems.map((c) => c.id).filter(Boolean))];

    // fetch product docs to get price and ensure product ObjectId for the Order model
    const productDocs = productIds.length ? await Product.find({ _id: { $in: productIds } }).lean() : [];

    const orderProducts = cartItems.map((ci) => {
      const prod = productDocs.find((d) => d._id.toString() === ci.id);
      return {
        product: prod?._id || ci.id, // use ObjectId if found, otherwise raw id (still required in schema)
        quantity: ci.q || 1,
        price: prod?.price ?? (ci.price ?? 0),
      };
    });

    const userId = session.metadata?.userId || undefined;

    const orderData = {
      user: userId,
      products: orderProducts,
      totalAmount: (session.amount_total || 0) / 100,
      stripeSessionId: session.id,
      status: "completed",
    };

    // avoid duplicate orders for same session
    const existing = await Order.findOne({ stripeSessionId: session.id }).lean();
    if (!existing) {
      const newOrder = new Order(orderData);
      await newOrder.save();
      console.log("✅ Order created from webhook/checkout:", newOrder._id);
    } else {
      console.log("ℹ️ Order for session already exists:", existing._id);
    }
  } catch (err) {
    console.error("Error creating order from webhook:", err);
  }

  // Decrement product stock
await Promise.all(
    orderProducts.map(async (item) => {
        await Product.findByIdAndUpdate(
            item.product,
            { $inc: { stock: -item.quantity } },
            { new: true }
        );
    })
);
}

async function createStripeCoupon(discountPercentage) {
  const coupon = await stripe.coupons.create({
    percent_off: discountPercentage,
    duration: "once",
  });

  return coupon.id;
}


async function createNewCoupon(userId) {
  await Coupon.findOneAndDelete({ userId });

  const newCoupon = new Coupon({
    code: "GIFT" + Math.random().toString(36).substring(2, 8).toUpperCase(),
    discountPercentage: 10,
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dana od sada
    userId: userId,
  });

  await newCoupon.save();

  return newCoupon;
}
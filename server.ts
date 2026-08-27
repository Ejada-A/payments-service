import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { Order } from './order.model';
import { Product } from './product.model';

dotenv.config();
dotenv.config({ path: '../../.env' });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5004;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-01-27.acacia' as any,
});

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Payments service connected to MongoDB'))
  .catch((err) => console.error('Payments service MongoDB connection error:', err));

// Stripe checkout endpoint
app.post('/payments/checkout', async (req, res) => {
  try {
    const { customerName, customerEmail, shippingAddress, items, origin } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Cart is empty' });
    }

    const line_items = [];
    let totalAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item._id || item.productId);
      if (!product) {
        return res.status(400).json({ success: false, error: `Product ${item._id || item.productId} not found` });
      }

      totalAmount += product.price * item.quantity;

      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: product.name,
            images: [product.imageUrl],
          },
          unit_amount: Math.round(product.price * 100), // In cents
        },
        quantity: item.quantity,
      });
    }

    // Pre-create the order as 'pending'
    const order = new Order({
      customerName,
      customerEmail,
      shippingAddress,
      totalAmount,
      status: 'pending',
    });
    await order.save();

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url: `${origin}/cart`,
      customer_email: customerEmail,
      client_reference_id: order._id.toString(),
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (error: any) {
    console.error('Stripe error inside payments service:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint for Kubernetes probes
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'healthy', service: 'payments-service' });
});

app.listen(PORT, () => {
  console.log(`Payments service running on port ${PORT}`);
});


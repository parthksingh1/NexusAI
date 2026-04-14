import Stripe from "stripe";
import { prisma } from "@nexusai/db";
import { logger } from "../logger.js";

const stripeKey = process.env.STRIPE_SECRET_KEY;

// Omit `apiVersion` — Stripe will use the account's default pinned version.
// Pinning a specific version here ties deploys to the SDK's TypeScript literal
// union, which breaks on every minor SDK upgrade. Cast to the SDK's expected
// config type so tsc doesn't block on missing-version errors.
export const stripe: Stripe | null = stripeKey
  ? new Stripe(stripeKey, {} as unknown as Stripe.StripeConfig)
  : null;

export type TierConfig = {
  tier: "FREE" | "PRO" | "TEAM" | "ENTERPRISE";
  priceId?: string;
  monthlyRunsIncluded: number;
  extraRunPriceUsd: number;
  monthlyCostCapUsd: number;
};

export const TIERS: Record<string, TierConfig> = {
  FREE:       { tier: "FREE",       monthlyRunsIncluded: 50,     extraRunPriceUsd: 0,    monthlyCostCapUsd: 5 },
  PRO:        { tier: "PRO",        priceId: process.env.STRIPE_PRICE_PRO,        monthlyRunsIncluded: 2000,   extraRunPriceUsd: 0.01, monthlyCostCapUsd: 50 },
  TEAM:       { tier: "TEAM",       priceId: process.env.STRIPE_PRICE_TEAM,       monthlyRunsIncluded: 20000,  extraRunPriceUsd: 0.008, monthlyCostCapUsd: 500 },
  ENTERPRISE: { tier: "ENTERPRISE", priceId: process.env.STRIPE_PRICE_ENTERPRISE, monthlyRunsIncluded: 200000, extraRunPriceUsd: 0.005, monthlyCostCapUsd: 5000 },
};

/** Report usage to Stripe's metered billing for overage charges. */
export async function reportUsage(userId: string, usdAmount: number): Promise<void> {
  if (!stripe) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) return;
    const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId, limit: 1 });
    const sub = subs.data[0];
    if (!sub) return;
    const item = sub.items.data[0];
    if (!item) return;
    await stripe.subscriptionItems.createUsageRecord(item.id, {
      quantity: Math.max(1, Math.round(usdAmount * 100)),
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });
  } catch (err) {
    logger.warn({ err, userId }, "stripe usage report failed");
  }
}

export async function createCheckout(userId: string, tier: "PRO" | "TEAM" | "ENTERPRISE", successUrl: string, cancelUrl: string): Promise<string> {
  if (!stripe) throw new Error("stripe not configured");
  const config = TIERS[tier];
  if (!config?.priceId) throw new Error(`price id missing for ${tier}`);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user not found");

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId } });
    customerId = customer.id;
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: config.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url ?? "";
}

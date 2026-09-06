import crypto from 'crypto';
import { PaymentProvider, PaystackNotConfiguredError, PaymentProviderError, InitializeResult } from '../payment-provider.interface';

function getPaystackConfig(): { secretKey: string; webhookSecret: string; publicKey: string | null } {
  const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? '').trim();
  const webhookSecret = (process.env.PAYSTACK_WEBHOOK_SECRET ?? process.env.PAYSTACK_SECRET_KEY ?? '').trim();
  const publicKey = (process.env.PAYSTACK_PUBLIC_KEY ?? '').trim() || null;
  if (!secretKey) throw new PaystackNotConfiguredError();
  return { secretKey, webhookSecret, publicKey };
}

/**
 * Paystack provider — isolated behind PaymentProvider interface.
 * No booking/finance logic imports paystack specifics.
 * When live credentials unavailable, initialize fails safely without creating fake PAID.
 * verifyWebhookSignature uses HMAC SHA512.
 */
export class PaystackPaymentProvider implements PaymentProvider {
  readonly gateway = 'paystack' as const;

  async initialize(input: { amount: number; currency: string; bookingId: string; customerEmail?: string | null; metadata?: Record<string, unknown> }): Promise<InitializeResult> {
    const cfg = getPaystackConfig();
    // Do not log secret. Validate amount server-authoritative already; just generate reference.
    // Deterministic non-live behavior: generate reference without external call.
    // Production would POST to https://api.paystack.co/transaction/initialize with secretKey.
    // To keep adapter replaceable and avoid network in slice, we simulate PROCESSING state.
    // Never mark PAID here — webhook must confirm.

    // Generate internal reference (deterministic, unique per booking)
    const reference = `WAASHA_${input.bookingId.slice(-8)}_${Date.now().toString(36).toUpperCase()}`;
    // Simulated gateway transaction id
    const gatewayTransactionId = `TRX_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    // If you have real credentials and want live initialize, you could optionally call Paystack here.
    // We deliberately do not require network; we return processing intent.
    // Fail-safe: if amount <=0, throw provider error
    if (input.amount <= 0) throw new PaymentProviderError('Invalid amount for Paystack initialization');

    // No console.log of secret
    void cfg.secretKey; // ensure used, not logged

    return {
      gatewayTransactionId,
      providerReference: reference,
      authorizationUrl: null, // Could be `https://checkout.paystack.com/${reference}` if live; null in test mode
      raw: { simulated: true, bookingId: input.bookingId, amount: input.amount, currency: input.currency },
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    try {
      const cfg = getPaystackConfig();
      const secret = cfg.webhookSecret || cfg.secretKey;
      if (!secret || !signature) return false;
      // Must use exact raw Buffer bytes — do not re-stringify or mutate JSON whitespace
      const data: Buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
      const hash = crypto.createHmac('sha512', secret).update(data).digest('hex');
      // Paystack sends signature as header `x-paystack-signature` as hex string
      // Use timingSafeEqual for constant-time comparison; require same length first
      if (hash.length !== signature.length) return false;
      return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
      return false;
    }
  }
}

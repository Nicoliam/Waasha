/**
 * Payment provider abstraction — isolates Paystack (or future provider) behind stable interface.
 * Booking/finance business logic must not import Paystack specifics.
 */

export type PaymentGateway = 'paystack' | 'manual_cash' | 'manual_eft';

export interface InitializeResult {
  gatewayTransactionId: string | null;
  providerReference: string | null;
  authorizationUrl?: string | null;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly gateway: PaymentGateway;
  /**
   * Initialize a provider-side transaction for an authoritative amount.
   * Must not mark payment as PAID — PAID only via webhook/verification.
   * Throws PaystackNotConfiguredError (503) if credentials missing.
   */
  initialize(input: {
    amount: number;
    currency: string;
    bookingId: string;
    customerEmail?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<InitializeResult>;

  /**
   * Verify webhook signature. Returns true if valid.
   * For paystack: HMAC SHA512 of raw body vs signature header using webhook secret.
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
}

export class PaystackNotConfiguredError extends Error {
  status = 503;
  code = 'PAYSTACK_NOT_CONFIGURED';
  constructor() {
    super('Paystack is not configured');
  }
}

export class PaymentProviderError extends Error {
  status = 502;
  code = 'PAYMENT_PROVIDER_ERROR';
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

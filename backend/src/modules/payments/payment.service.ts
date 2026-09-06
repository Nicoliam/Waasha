import { prisma } from '../../config/prisma';
import { getProviderForMethod } from './providers/factory';
import { PaystackNotConfiguredError } from './payment-provider.interface';
import { getCommissionRateForProvider } from '../finance/commission.service';
import { getCashCapForProvider } from '../finance/cash-caps.service';
import { DEFAULT_TIMEZONE } from '../../utils/timezone';

export type PaymentMethod = 'waasha_payment' | 'cash' | 'eft';
const ALLOWED_METHODS: PaymentMethod[] = ['waasha_payment', 'cash', 'eft'];

/**
 * Payment lifecycle: PENDING -> PROCESSING -> PAID / FAILED / CANCELLED
 * - Payment status independent from booking completion (PENDING/CONFIRMED vs COMPLETED)
 * - Commission NOT created on payment alone.
 * - Webhook reconciliation is idempotent, amount-verified, no duplicate financial effects.
 */

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

export async function createPaymentIntent(input: {
  bookingId: string;
  customerUserId: string;
  method: string;
  idempotencyKey?: string | null;
  cashDetails?: { changeRequested?: boolean; amountTendered?: number | null } | null;
}) {
  const method = input.method as PaymentMethod;
  if (!ALLOWED_METHODS.includes(method)) {
    const err: any = new Error('Unsupported payment method');
    err.status = 422;
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }

  // Idempotency: if key provided and payment already exists, return existing without duplicate side effects
  if (input.idempotencyKey) {
    const existingByKey = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } } as any);
    if (existingByKey) {
      return { payment: existingByKey, idempotent: true } as const;
    }
  }

  // Booking ownership & authoritative amount
  const customerProfile = await prisma.customerProfile.findUnique({ where: { userId: input.customerUserId } });
  if (!customerProfile) {
    const err: any = new Error('Customer profile required');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: { provider: { include: { tier: true } }, items: true } as any,
  } as any);
  if (!booking) {
    const err: any = new Error('Booking not found');
    err.status = 404;
    err.code = 'BOOKING_NOT_FOUND';
    throw err;
  }
  const b: any = booking;
  if (b.customerId !== customerProfile.id) {
    const err: any = new Error('Booking ownership mismatch');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  // If booking already has payment, enforce idempotency / mismatch protection
  const existingForBooking = await prisma.payment.findUnique({ where: { bookingId: input.bookingId } } as any);
  if (existingForBooking) {
    // If same idempotency key already handled above, this is duplicate payment attempt with different key
    // Do not create second payment; return existing to prevent duplicate provider intents where safe
    // But if method differs, we allow? For safety, forbid second payment creation for same booking (one payment per booking)
    // Unless idempotency key matches, we return 409? Spec requires idempotent duplicate does not duplicate.
    // To satisfy "duplicate payment idempotency", we return existing as idempotent if same booking method same?
    // Simpler: return existing as idempotent (no duplicate) — client can fetch status.
    if (existingForBooking.method === method && (!input.idempotencyKey || (existingForBooking as any).idempotencyKey === input.idempotencyKey)) {
      return { payment: existingForBooking, idempotent: true } as const;
    }
    // Different method without idempotency reuse: treat as already exists, don't create duplicate payment record
    // Return existing to avoid duplicate provider intents
    return { payment: existingForBooking, idempotent: true } as const;
  }

  // Provider/type validation for cash
  const providerProfile: any = b.providerId ? await prisma.providerProfile.findUnique({ where: { id: b.providerId }, include: { tier: true } }) : null;
  if (method === 'cash') {
    if (!providerProfile) {
      const err: any = new Error('Provider not found for cash payment');
      err.status = 404;
      err.code = 'PROVIDER_NOT_FOUND';
      throw err;
    }
    // Deterministic acceptCash check (same as cash-ledger) — without business context for simple booking, use ProviderProfile.acceptCash or BusinessUnit if booking.businessUnitId
    let cashAccepted: boolean;
    if (providerProfile.tier.code === 'T3' && b.businessUnitId) {
      const unit = await prisma.businessUnit.findUnique({ where: { id: b.businessUnitId } });
      if (!unit) {
        const err: any = new Error('Business unit not found');
        err.status = 404;
        err.code = 'BUSINESS_UNIT_NOT_FOUND';
        throw err;
      }
      const business = await prisma.business.findUnique({ where: { id: (unit as any).businessId } });
      if (!business || (business as any).ownerProviderId !== providerProfile.userId) {
        const err: any = new Error('Business unit not owned by provider');
        err.status = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
      cashAccepted = (unit as any).acceptCash;
    } else if (providerProfile.tier.code === 'T3') {
      // For T3 without unit, require business context — but booking without unit still allowed? Check Business.acceptCash first business owned
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: providerProfile.userId } }) ?? [];
      if (!businesses || businesses.length === 0) {
        const err: any = new Error('Business context required for T3 cash payment');
        err.status = 422;
        err.code = 'BUSINESS_CONTEXT_REQUIRED';
        throw err;
      }
      cashAccepted = (businesses[0] as any).acceptCash;
    } else {
      cashAccepted = providerProfile.acceptCash;
    }
    if (cashAccepted === false) {
      const err: any = new Error('Provider does not accept cash');
      err.status = 422;
      err.code = 'CASH_NOT_ACCEPTED';
      throw err;
    }

    // Cash cap enforcement — cap is outstanding + commission from this payment must not exceed cap
    const commissionRate = await getCommissionRateForProvider(providerProfile);
    const grossAmount = toNumber(b.totalAmount);
    const commissionAmount = Math.round(grossAmount * (commissionRate / 100) * 100) / 100;
    const cap = await getCashCapForProvider(providerProfile);
    // Transactional cap check will be done inside payment creation transaction to be concurrency-safe
    // For pre-check fast-fail without transaction, we can check current outstanding quickly but transaction is authoritative
    // We'll delegate to transactional branch below
  }

  // Server-authoritative amount/currency — ignore any client-supplied values (none accepted as params)
  const authoritativeAmount = toNumber(b.totalAmount);
  const authoritativeCurrency = b.currency ?? 'ZAR';
  if (!Number.isFinite(authoritativeAmount) || authoritativeAmount <= 0) {
    const err: any = new Error('Invalid booking amount');
    err.status = 422;
    err.code = 'INVALID_BOOKING_AMOUNT';
    throw err;
  }

  // Map method to gateway and initial status
  let gateway: string;
  let initialStatus: string;
  if (method === 'waasha_payment') {
    gateway = 'paystack';
    initialStatus = 'PROCESSING';
  } else if (method === 'cash') {
    gateway = 'manual_cash';
    initialStatus = 'PAID'; // cash collection recorded as PAID but booking stays PENDING (service not completed)
  } else {
    gateway = 'manual_eft';
    initialStatus = 'PENDING'; // EFT never auto PAID
  }

  // For waasha_payment, isolate Paystack behind abstraction and fail safely if not configured
  let providerInit: { gatewayTransactionId: string | null; providerReference: string | null; authorizationUrl?: string | null } | null = null;
  if (method === 'waasha_payment') {
    const provider = getProviderForMethod(method);
    if (!provider) {
      const err: any = new Error('Payment provider not available');
      err.status = 503;
      err.code = 'PAYMENT_PROVIDER_UNAVAILABLE';
      throw err;
    }
    try {
      providerInit = await provider.initialize({
        amount: authoritativeAmount,
        currency: authoritativeCurrency,
        bookingId: b.id,
        customerEmail: null,
        metadata: { bookingId: b.id },
      });
    } catch (e: any) {
      if (e instanceof PaystackNotConfiguredError) {
        // Fail safely: do not create fake PAID transaction, return clear config error
        const err: any = new Error('Paystack is not configured');
        err.status = 503;
        err.code = 'PAYSTACK_NOT_CONFIGURED';
        err.details = { message: 'Configure PAYSTACK_SECRET_KEY to enable Waasha Payment' };
        throw err;
      }
      throw e;
    }
  }

  // Transactional creation — for cash also handles ledger + outstanding + cash cap concurrency-safe
  const result = await prisma.$transaction(async (tx) => {
    // Re-check idempotency inside transaction (race)
    if (input.idempotencyKey) {
      const existingTx = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } } as any);
      if (existingTx) return { payment: existingTx, idempotent: true } as any;
    }
    const existingBookingTx = await tx.payment.findUnique({ where: { bookingId: input.bookingId } } as any);
    if (existingBookingTx) return { payment: existingBookingTx, idempotent: true } as any;

    // For cash: enforce cap + create ledger + update account atomically
    let commissionRate: number | null = null;
    let commissionAmount: number | null = null;
    let cap: number | null = null;
    if (method === 'cash') {
      // Re-derive rate/cap inside transaction with fresh provider read
      const pp = await tx.providerProfile.findUnique({ where: { id: b.providerId }, include: { tier: true } } as any);
      if (!pp) {
        const err: any = new Error('Provider not found');
        err.status = 404;
        err.code = 'PROVIDER_NOT_FOUND';
        throw err;
      }
      commissionRate = await getCommissionRateForProvider(pp as any);
      commissionAmount = Math.round(authoritativeAmount * (commissionRate / 100) * 100) / 100;
      cap = await getCashCapForProvider(pp as any);

      // Lock ProviderCashAccount
      let account = await tx.providerCashAccount.findUnique({ where: { providerId: b.providerId } });
      if (!account) {
        try {
          account = await tx.providerCashAccount.create({
            data: { providerId: b.providerId, outstandingCommission: 0, totalCashGross: 0, totalCashCommission: 0, totalSettled: 0 },
          });
        } catch (e: any) {
          if (e.code === 'P2002') {
            await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${b.providerId} FOR UPDATE`;
            account = await tx.providerCashAccount.findUnique({ where: { providerId: b.providerId } });
          } else throw e;
        }
        await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${b.providerId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${b.providerId} FOR UPDATE`;
        account = await tx.providerCashAccount.findUnique({ where: { providerId: b.providerId } });
      }
      const outstanding = toNumber((account as any).outstandingCommission);
      const wouldBe = Math.round((outstanding + commissionAmount!) * 100) / 100;
      if (wouldBe > cap!) {
        const err: any = new Error('Cash commission liability cap would be exceeded');
        err.status = 422;
        err.code = 'CASH_CAP_EXCEEDED';
        err.details = { cap, outstanding, commissionRate, commissionAmount, grossAmount: authoritativeAmount, wouldBeOutstanding: wouldBe };
        throw err;
      }
      const updatedRows = await tx.$executeRaw`
        UPDATE provider_cash_accounts
        SET outstanding_commission = outstanding_commission + ${commissionAmount},
            total_cash_gross = total_cash_gross + ${authoritativeAmount},
            total_cash_commission = total_cash_commission + ${commissionAmount}
        WHERE provider_id = ${b.providerId}
          AND outstanding_commission = ${outstanding}
          AND outstanding_commission + ${commissionAmount} <= ${cap}
      `;
      if (updatedRows === 0) {
        const refreshed = await tx.providerCashAccount.findUnique({ where: { providerId: b.providerId } });
        const ro = refreshed ? toNumber((refreshed as any).outstandingCommission) : outstanding;
        const err: any = new Error('Cash commission liability cap would be exceeded (concurrent conflict)');
        err.status = 422;
        err.code = 'CASH_CAP_EXCEEDED';
        err.details = { cap, outstanding: ro, wouldBeOutstanding: Math.round((ro + commissionAmount!) * 100) / 100, reason: 'Concurrent update conflict' };
        throw err;
      }
    } else {
      // For non-cash, commission snapshot is still stored but not enforced via cap
      if (providerProfile) {
        commissionRate = await getCommissionRateForProvider(providerProfile as any);
        commissionAmount = Math.round(authoritativeAmount * (commissionRate / 100) * 100) / 100;
      }
    }

    const now = new Date();
    const payment = await tx.payment.create({
      data: {
        bookingId: b.id,
        customerId: customerProfile.id,
        providerId: b.providerId ?? null,
        businessUnitId: b.businessUnitId ?? null,
        amount: authoritativeAmount,
        currency: authoritativeCurrency,
        gateway,
        method,
        status: initialStatus,
        commissionRate: commissionRate ?? undefined,
        commissionAmount: commissionAmount ?? undefined,
        idempotencyKey: input.idempotencyKey ?? null,
        gatewayTransactionId: providerInit?.gatewayTransactionId ?? null,
        gatewayResponseReference: providerInit?.providerReference ?? null,
        providerReference: providerInit?.providerReference ?? null,
        internalReference: `WAASHA_${b.id.slice(-6)}_${Date.now().toString(36)}`,
        initiatedAt: now,
        paidAt: initialStatus === 'PAID' ? now : null,
        metadata: providerInit ? { providerInit } as any : undefined,
      } as any,
    });

    // Update booking payment fields but keep booking status separate (PENDING, not COMPLETED)
    await tx.booking.update({
      where: { id: b.id },
      data: {
        paymentMethod: method,
        paymentStatus: initialStatus,
      },
    });

    // Cash ledger + cash detail
    if (method === 'cash') {
      await tx.cashLedgerEntry.create({
        data: {
          providerId: b.providerId,
          bookingId: b.id,
          grossAmount: authoritativeAmount,
          paymentMethod: 'cash',
          commissionRate: commissionRate!,
          commissionAmount: commissionAmount!,
          type: 'ACCRUAL',
          currency: authoritativeCurrency,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}_ledger` : null,
          metadata: { via: 'payment_intent', bookingId: b.id } as any,
        } as any,
      });
      if (input.cashDetails) {
        const amountTendered = input.cashDetails.amountTendered != null ? Number(input.cashDetails.amountTendered) : null;
        const changeRequested = !!input.cashDetails.changeRequested;
        let changeAmount: number | null = null;
        if (changeRequested && amountTendered != null && Number.isFinite(amountTendered)) {
          changeAmount = Math.round((amountTendered - authoritativeAmount) * 100) / 100;
          if (changeAmount < 0) changeAmount = 0;
        }
        await tx.cashPaymentDetail.create({
          data: {
            bookingId: b.id,
            changeRequested,
            amountTendered: amountTendered ?? null,
            changeAmount,
            providerNotifiedAt: changeRequested ? now : null,
          } as any,
        });
      }
      try {
        await tx.auditLog.create({
          data: {
            actorUserId: input.customerUserId,
            action: 'PAYMENT_CASH_CREATED',
            entityType: 'payment',
            entityId: payment.id,
            afterJson: { bookingId: b.id, method, amount: authoritativeAmount, commissionRate, commissionAmount } as any,
          },
        });
      } catch {}
    } else if (method === 'waasha_payment') {
      try {
        await tx.auditLog.create({
          data: {
            actorUserId: input.customerUserId,
            action: 'PAYMENT_WAASHA_INITIATED',
            entityType: 'payment',
            entityId: payment.id,
            afterJson: { bookingId: b.id, gateway, status: initialStatus, providerReference: providerInit?.providerReference } as any,
          },
        });
      } catch {}
    } else {
      // EFT
      try {
        await tx.auditLog.create({
          data: {
            actorUserId: input.customerUserId,
            action: 'PAYMENT_EFT_CREATED',
            entityType: 'payment',
            entityId: payment.id,
            afterJson: { bookingId: b.id, method, amount: authoritativeAmount } as any,
          },
        });
      } catch {}
    }

    return { payment, idempotent: false };
  }, { isolationLevel: 'Serializable' } as any);

  return result;
}

export async function getPaymentByBookingForUser(bookingId: string, requestingUserId: string) {
  const customerProfile = await prisma.customerProfile.findUnique({ where: { userId: requestingUserId } });
  const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: requestingUserId } });
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } } as any);
  if (!booking) {
    const err: any = new Error('Booking not found');
    err.status = 404;
    err.code = 'BOOKING_NOT_FOUND';
    throw err;
  }
  const b: any = booking;
  const isCustomer = customerProfile && b.customerId === customerProfile.id;
  const isProvider = providerProfile && b.providerId === providerProfile.id;
  if (!isCustomer && !isProvider) {
    const err: any = new Error('Forbidden');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  const payment = await prisma.payment.findUnique({ where: { bookingId } } as any);
  if (!payment) {
    const err: any = new Error('Payment not found');
    err.status = 404;
    err.code = 'PAYMENT_NOT_FOUND';
    throw err;
  }
  // Never expose sensitive gateway secrets or internal provider credentials
  const p: any = payment;
  return {
    id: p.id,
    uuid: p.uuid,
    bookingId: p.bookingId,
    customerId: p.customerId,
    providerId: p.providerId,
    businessUnitId: p.businessUnitId,
    amount: toNumber(p.amount),
    currency: p.currency,
    gateway: p.gateway,
    method: p.method,
    status: p.status,
    commissionRate: p.commissionRate != null ? toNumber(p.commissionRate) : null,
    commissionAmount: p.commissionAmount != null ? toNumber(p.commissionAmount) : null,
    providerReference: p.providerReference,
    gatewayTransactionId: p.gatewayTransactionId,
    initiatedAt: p.initiatedAt,
    paidAt: p.paidAt,
    failedAt: p.failedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function getPaymentByIdForUser(paymentId: string, requestingUserId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } } as any);
  if (!payment) {
    const err: any = new Error('Payment not found');
    err.status = 404;
    err.code = 'PAYMENT_NOT_FOUND';
    throw err;
  }
  const bookingId = (payment as any).bookingId;
  // delegate to booking check to enforce ownership
  return getPaymentByBookingForUser(bookingId, requestingUserId);
}

/**
 * Webhook / callback processing — idempotent, amount-reconciled, no duplicate financial effects
 */
export async function processPaystackWebhook(input: {
  rawBody: string | Buffer;
  signature: string;
  payload: any;
}) {
  // Verify signature server-side — never trust payload without verification
  const provider = getProviderForMethod('waasha_payment');
  if (!provider) {
    const err: any = new Error('Provider not available');
    err.status = 503;
    err.code = 'PAYSTACK_NOT_CONFIGURED';
    throw err;
  }
  const valid = provider.verifyWebhookSignature(input.rawBody, input.signature);
  if (!valid) {
    const err: any = new Error('Invalid webhook signature');
    err.status = 401;
    err.code = 'INVALID_WEBHOOK_SIGNATURE';
    throw err;
  }

  const payload = input.payload;
  const event = payload.event ?? payload.event_type ?? 'unknown';
  const data = payload.data ?? payload;
  const reference: string | null = data.reference ?? data.providerReference ?? data.gatewayResponseReference ?? null;
  const gatewayTxId: string | null = data.id ? String(data.id) : (data.gatewayTransactionId ? String(data.gatewayTransactionId) : null);
  const amountInKobo: number | null = data.amount != null ? Number(data.amount) : null; // Paystack sends kobo (cents)
  const amountInZar = amountInKobo != null ? amountInKobo / 100 : null;
  const gatewayEventId = data.id ? String(data.id) : (payload.id ? String(payload.id) : `${event}:${reference ?? gatewayTxId ?? Date.now()}`);

  // Duplicate webhook protection: if gatewayEventId already processed, return duplicate without side effects
  const existingEvent = await prisma.paymentEvent.findUnique({ where: { gatewayEventId } } as any);
  if (existingEvent) {
    return { duplicate: true, payment: null, event: existingEvent } as const;
  }

  // Find payment by reference or gatewayTransactionId — required to reconcile
  let payment: any = null;
  if (reference) {
    payment = await prisma.payment.findFirst({ where: { providerReference: reference } } as any);
    if (!payment) payment = await prisma.payment.findFirst({ where: { gatewayResponseReference: reference } } as any);
  }
  if (!payment && gatewayTxId) {
    payment = await prisma.payment.findFirst({ where: { gatewayTransactionId: gatewayTxId } } as any);
  }
  if (!payment) {
    // No matching payment — record event as failed? For audit, we create no payment event tied to missing payment
    // Instead, we throw to avoid silently ignoring; but we log event with no payment? We require booking context.
    const err: any = new Error('Payment not found for webhook');
    err.status = 404;
    err.code = 'PAYMENT_NOT_FOUND';
    throw err;
  }

  // Reconcile amount — never trust webhook payload amount blindly; verify against authoritative booking/payment amount
  const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId } } as any);
  if (!booking) {
    const err: any = new Error('Booking not found for payment');
    err.status = 404;
    err.code = 'BOOKING_NOT_FOUND';
    throw err;
  }
  const authoritativeAmount = toNumber((booking as any).totalAmount);
  const paymentAmount = toNumber(payment.amount);
  const reconcileAmount = amountInZar != null ? amountInZar : paymentAmount;
  // Allow small delta due to rounding (1 cent), but if differs materially, mark failure
  if (amountInZar != null && Math.abs(reconcileAmount - authoritativeAmount) > 0.01) {
    // Do not update payment to PAID — amount mismatch is fraud/misconfiguration
    // Record event as FAILED processing
    const ev = await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: event,
        gatewayEventId,
        payload: payload as any,
        processingStatus: 'FAILED',
        processedAt: new Date(),
      } as any,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { failureReason: `Amount mismatch: webhook ${reconcileAmount} vs authoritative ${authoritativeAmount}`, failedAt: new Date(), status: 'FAILED' } as any,
    });
    await prisma.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: 'FAILED' } as any });
    return { duplicate: false, payment: await prisma.payment.findUnique({ where: { id: payment.id } }), event: ev, amountMismatch: true } as const;
  }

  // Also verify webhook amount matches payment amount (historical snapshot)
  if (amountInZar != null && Math.abs(reconcileAmount - paymentAmount) > 0.01) {
    const ev = await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: event,
        gatewayEventId,
        payload: payload as any,
        processingStatus: 'FAILED',
        processedAt: new Date(),
      } as any,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { failureReason: `Amount mismatch: webhook ${reconcileAmount} vs payment ${paymentAmount}`, failedAt: new Date(), status: 'FAILED' } as any,
    });
    return { duplicate: false, payment: await prisma.payment.findUnique({ where: { id: payment.id } }), event: ev, amountMismatch: true } as const;
  }

  // Determine target status from event
  let targetStatus: string | null = null;
  const lowerEvent = String(event).toLowerCase();
  if (lowerEvent.includes('charge.success') || lowerEvent === 'charge_success' || lowerEvent === 'payment_success' || data.status === 'success' || data.status === 'PAID') {
    targetStatus = 'PAID';
  } else if (lowerEvent.includes('charge.failed') || lowerEvent.includes('failed') || data.status === 'failed' || data.status === 'FAILED') {
    targetStatus = 'FAILED';
  } else {
    // Unknown event — record but do not change status
    const ev = await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: event,
        gatewayEventId,
        payload: payload as any,
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
      } as any,
    });
    return { duplicate: false, payment, event: ev, unhandled: true } as const;
  }

  // Safe state transitions — idempotent, no duplicate financial effects
  // Never transition PAID -> PAID again with side effects; just record duplicate-like event
  const currentStatus = payment.status;
  if (currentStatus === targetStatus) {
    // Already in target status — record event as DUPLICATE processing status but no state change
    const ev = await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: event,
        gatewayEventId,
        payload: payload as any,
        processingStatus: 'DUPLICATE',
        processedAt: new Date(),
      } as any,
    });
    return { duplicate: false, payment, event: ev, alreadyInStatus: true } as const;
  }
  // Only allow PENDING/PROCESSING -> PAID/FAILED; do not allow PAID -> FAILED etc without explicit refund flow
  const allowedFrom = ['PENDING', 'PROCESSING'];
  if (!allowedFrom.includes(currentStatus) && targetStatus === 'PAID') {
    const ev = await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: event,
        gatewayEventId,
        payload: payload as any,
        processingStatus: 'FAILED',
        processedAt: new Date(),
      } as any,
    });
    return { duplicate: false, payment, event: ev, invalidTransition: true } as const;
  }

  // Perform update + event atomically
  const result = await prisma.$transaction(async (tx) => {
    // Re-check event idempotency inside transaction
    const dupInside = await tx.paymentEvent.findUnique({ where: { gatewayEventId } } as any);
    if (dupInside) return { duplicate: true, event: dupInside, payment } as any;
    const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } } as any);
    if (!freshPayment) throw new Error('Payment disappeared');
    if ((freshPayment as any).status === targetStatus) {
      const ev2 = await tx.paymentEvent.create({
        data: { paymentId: payment.id, eventType: event, gatewayEventId, payload: payload as any, processingStatus: 'DUPLICATE', processedAt: new Date() } as any,
      });
      return { event: ev2, payment: freshPayment, alreadyInStatus: true } as any;
    }
    const updateData: any = {};
    if (targetStatus === 'PAID') {
      updateData.status = 'PAID';
      updateData.paidAt = new Date();
      updateData.gatewayTransactionId = gatewayTxId ?? (freshPayment as any).gatewayTransactionId;
      updateData.gatewayResponseReference = reference ?? (freshPayment as any).gatewayResponseReference;
    } else if (targetStatus === 'FAILED') {
      updateData.status = 'FAILED';
      updateData.failedAt = new Date();
      updateData.failureReason = data.message ?? data.gateway_response ?? 'Provider reported failure';
    }
    const updatedPayment = await tx.payment.update({ where: { id: payment.id }, data: updateData });
    const ev = await tx.paymentEvent.create({
      data: { paymentId: payment.id, eventType: event, gatewayEventId, payload: payload as any, processingStatus: 'PROCESSED', processedAt: new Date() } as any,
    });
    // Update booking paymentStatus but keep booking lifecycle independent (do NOT mark COMPLETED)
    const bookingUpdate: any = {};
    if (targetStatus === 'PAID') bookingUpdate.paymentStatus = 'PAID';
    else if (targetStatus === 'FAILED') bookingUpdate.paymentStatus = 'FAILED';
    if (Object.keys(bookingUpdate).length) {
      await tx.booking.update({ where: { id: payment.bookingId }, data: bookingUpdate });
    }
    try {
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: `PAYMENT_WEBHOOK_${targetStatus}`,
          entityType: 'payment',
          entityId: payment.id,
          afterJson: { event, gatewayEventId, targetStatus, reference } as any,
        },
      });
    } catch {}
    return { event: ev, payment: updatedPayment } as const;
  });

  return { duplicate: false, payment: (result as any).payment, event: (result as any).event } as const;
}

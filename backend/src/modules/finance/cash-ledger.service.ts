import { prisma } from '../../config/prisma';
import { getCommissionRateForProvider } from './commission.service';
import { getCashCapForProvider } from './cash-caps.service';
import { DEFAULT_TIMEZONE } from '../../utils/timezone';

export class CashCapExceededError extends Error {
  status = 422;
  code = 'CASH_CAP_EXCEEDED';
  details: any;
  constructor(details: any) {
    super('Cash commission liability cap would be exceeded');
    this.details = details;
  }
}

export class CashNotAcceptedError extends Error {
  status = 422;
  code = 'CASH_NOT_ACCEPTED';
  constructor() {
    super('Provider does not accept cash payments');
  }
}

/**
 * Transactionally create a cash booking + payment + ledger entry + update ProviderCashAccount.
 * Enforces: acceptCash, Student verification, commission rate, cash cap (outstanding + new <= cap).
 * Uses interactive transaction to prevent race conditions.
 */
export async function createCashBooking(input: {
  providerId: string;
  customerId: string;
  grossAmount: number;
  currency?: string;
  serviceId?: string | null;
  businessId?: string | null;
  businessUnitId?: string | null;
  description?: string | null;
  idempotencyKey?: string | null;
  ipAddress?: string;
  userAgent?: string;
}) {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: input.providerId },
    include: { tier: true },
  });
  if (!provider) {
    const err: any = new Error('Provider not found');
    err.status = 404;
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }

  // Deterministic T3 cash acceptance rule — server-authoritative, no guessing
  // T1/T2/STUDENT: ProviderProfile.acceptCash
  // T3: if businessUnitId → BusinessUnit.acceptCash (with ownership check)
  //     else if businessId → Business.acceptCash (with ownership check)
  //     else → 422 BUSINESS_CONTEXT_REQUIRED (must specify business context)
  let cashAccepted: boolean;
  if (provider.tier.code === 'T3' && input.businessUnitId) {
    const unit = await prisma.businessUnit.findUnique({ where: { id: input.businessUnitId } });
    if (!unit) {
      const err: any = new Error('Business unit not found');
      err.status = 404;
      err.code = 'BUSINESS_UNIT_NOT_FOUND';
      throw err;
    }
    const business = await prisma.business.findUnique({ where: { id: unit.businessId } });
    if (!business || business.ownerProviderId !== provider.userId) {
      const err: any = new Error('Business unit not owned by provider');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    cashAccepted = unit.acceptCash;
  } else if (provider.tier.code === 'T3' && input.businessId) {
    const business = await prisma.business.findUnique({ where: { id: input.businessId } });
    if (!business) {
      const err: any = new Error('Business not found');
      err.status = 404;
      err.code = 'BUSINESS_NOT_FOUND';
      throw err;
    }
    if (business.ownerProviderId !== provider.userId) {
      const err: any = new Error('Business not owned by provider');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    cashAccepted = business.acceptCash;
  } else if (provider.tier.code === 'T3') {
    const err: any = new Error('Business context required for T3 cash booking: provide businessId or businessUnitId');
    err.status = 422;
    err.code = 'BUSINESS_CONTEXT_REQUIRED';
    throw err;
  } else {
    cashAccepted = provider.acceptCash;
  }
  if (cashAccepted === false) {
    throw new CashNotAcceptedError();
  }

  // Idempotency: if idempotencyKey provided and ledger entry already exists, return existing (no double accrual)
  if (input.idempotencyKey) {
    const existing = await prisma.cashLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const booking = existing.bookingId ? await prisma.booking.findUnique({ where: { id: existing.bookingId } }) : null;
      const payment = existing.bookingId ? await prisma.payment.findUnique({ where: { bookingId: existing.bookingId } }) : null;
      const account = await prisma.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
      return { booking, payment, ledger: existing, account, commissionRate: Number(existing.commissionRate), commissionAmount: Number(existing.commissionAmount), cap: await getCashCapForProvider(provider as any), outstandingBefore: 0, outstandingAfter: 0, idempotent: true } as any;
    }
  }

  // Commission rate — Student verified 16%, else tier 25%
  const commissionRate = await getCommissionRateForProvider(provider as any);
  const commissionAmount = Math.round(input.grossAmount * (commissionRate / 100) * 100) / 100;
  const cap = await getCashCapForProvider(provider as any);

  // Transactional cap check + creation — concurrency-safe via SELECT ... FOR UPDATE + Serializable isolation
  // MySQL SERIALIZABLE + FOR UPDATE ensures two concurrent bookings cannot both pass cap.
  const result = await prisma.$transaction(
    async (tx) => {
      // Ensure ProviderCashAccount exists and lock it for update
      let account = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
      if (!account) {
        try {
          account = await tx.providerCashAccount.create({
            data: {
              providerId: input.providerId,
              outstandingCommission: 0,
              totalCashGross: 0,
              totalCashCommission: 0,
              totalSettled: 0,
            },
          });
        } catch (e: any) {
          // Race: another transaction created it concurrently — fetch with lock
          if (e.code === 'P2002') {
            await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${input.providerId} FOR UPDATE`;
            account = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
            if (!account) throw e;
          } else {
            throw e;
          }
        }
        // Lock newly created row
        await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${input.providerId} FOR UPDATE`;
      } else {
        // Lock existing row before reading outstanding
        await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${input.providerId} FOR UPDATE`;
        // Re-read after lock to get latest committed value (in case another tx committed just before our lock)
        account = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
        if (!account) throw new Error('ProviderCashAccount disappeared after lock');
      }

      const outstanding = Number(account!.outstandingCommission);
      const wouldBeOutstanding = Math.round((outstanding + commissionAmount) * 100) / 100;
      if (wouldBeOutstanding > cap) {
        throw new CashCapExceededError({
          cap,
          outstanding,
          commissionRate,
          commissionAmount,
          grossAmount: input.grossAmount,
          wouldBeOutstanding,
          providerTier: provider.tier.code,
          isStudentVerified: provider.isStudent && provider.studentVerificationStatus === 'VERIFIED',
        });
      }

      // Atomic conditional update — ensures no other transaction slipped in between check and update
      // This is defense-in-depth; FOR UPDATE already serializes, but conditional update guarantees > cap never written
      const updatedRows = await tx.$executeRaw`
        UPDATE provider_cash_accounts
        SET outstanding_commission = outstanding_commission + ${commissionAmount},
            total_cash_gross = total_cash_gross + ${input.grossAmount},
            total_cash_commission = total_cash_commission + ${commissionAmount}
        WHERE provider_id = ${input.providerId}
          AND outstanding_commission = ${outstanding}
          AND outstanding_commission + ${commissionAmount} <= ${cap}
      `;
      if (updatedRows === 0) {
        // Could be cap exceeded due to race, or concurrent update changed outstanding
        const refreshed = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
        const refreshedOutstanding = refreshed ? Number(refreshed.outstandingCommission) : outstanding;
        throw new CashCapExceededError({
          cap,
          outstanding: refreshedOutstanding,
          commissionRate,
          commissionAmount,
          grossAmount: input.grossAmount,
          wouldBeOutstanding: Math.round((refreshedOutstanding + commissionAmount) * 100) / 100,
          providerTier: provider.tier.code,
          isStudentVerified: provider.isStudent && provider.studentVerificationStatus === 'VERIFIED',
          reason: 'Concurrent update conflict — retry',
        });
      }

      // Create booking — Phase 1.5 financial ledger is SEPARATE from booking COMPLETED lifecycle.
      // Booking remains PENDING until service is actually performed; paymentStatus PAID records cash collection.
      // Future booking engine will transition PENDING -> CONFIRMED -> IN_PROGRESS -> COMPLETED independently.
      const booking = await tx.booking.create({
        data: {
          customerId: input.customerId,
          providerId: input.providerId,
          businessUnitId: input.businessUnitId ?? null,
          serviceId: input.serviceId ?? null,
          bookingType: 'STANDARD',
          serviceLocationType: 'PROVIDER',
          scheduledStart: new Date(),
          scheduledEnd: new Date(Date.now() + 60 * 60 * 1000),
          timezone: DEFAULT_TIMEZONE,
          // Financial ledger (ACCRUAL) is separate from service COMPLETED lifecycle.
          // Booking stays PENDING until actual service is performed; paymentStatus PAID records cash collection.
          status: 'PENDING',
          currency: input.currency ?? 'ZAR',
          subtotal: input.grossAmount,
          totalAmount: input.grossAmount,
          paymentMethod: 'cash',
          paymentStatus: 'PAID',
        },
      });

    // Create payment snapshot (immutable)
    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        customerId: input.customerId,
        amount: input.grossAmount,
        currency: input.currency ?? 'ZAR',
        gateway: 'manual_cash',
        method: 'cash',
        status: 'PAID',
        commissionRate,
        commissionAmount,
      },
    });

    // Create ledger entry (immutable) — idempotency via idempotencyKey or bookingId unique
    const ledger = await tx.cashLedgerEntry.create({
      data: {
        providerId: input.providerId,
        bookingId: booking.id,
        grossAmount: input.grossAmount,
        paymentMethod: 'cash',
        commissionRate,
        commissionAmount,
        type: 'ACCRUAL',
        currency: input.currency ?? 'ZAR',
        idempotencyKey: input.idempotencyKey ?? null,
        metadata: { description: input.description ?? null, businessUnitId: input.businessUnitId ?? null } as any,
      },
    });

    // Fetch updated account after atomic increment (already updated via $executeRaw)
    const updatedAccount = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });

    // Audit
    try {
      await tx.auditLog.create({
        data: {
          actorUserId: input.customerId,
          action: 'CASH_BOOKING_CREATED',
          entityType: 'booking',
          entityId: booking.id,
          afterJson: {
            bookingId: booking.id,
            providerId: input.providerId,
            grossAmount: input.grossAmount,
            commissionRate,
            commissionAmount,
            cap,
            outstandingBefore: outstanding,
            outstandingAfter: wouldBeOutstanding,
          } as any,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch {}

    return { booking, payment, ledger, account: updatedAccount, commissionRate, commissionAmount, cap, outstandingBefore: outstanding, outstandingAfter: wouldBeOutstanding };
  }, { isolationLevel: 'Serializable' } as any);

  return result;
}

export async function settleCashLiability(input: {
  providerId: string;
  amount: number;
  actorUserId?: string;
  idempotencyKey?: string | null;
  ipAddress?: string;
  userAgent?: string;
}) {
  if (input.amount <= 0) {
    const err: any = new Error('Settlement amount must be positive');
    err.status = 422;
    err.code = 'INVALID_SETTLEMENT_AMOUNT';
    throw err;
  }
  // Idempotency: if key provided and already exists, return existing without double-settling
  if (input.idempotencyKey) {
    const existing = await prisma.cashLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const account = await prisma.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
      return { account, ledger: existing, outstandingBefore: account ? Number(account.outstandingCommission) : 0, outstandingAfter: account ? Number(account.outstandingCommission) : 0, idempotent: true } as any;
    }
  }
  const result = await prisma.$transaction(async (tx) => {
    // Idempotency inside transaction as well (race)
    if (input.idempotencyKey) {
      const existingTx = await tx.cashLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existingTx) {
        const acc = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
        return { account: acc, ledger: existingTx, outstandingBefore: acc ? Number(acc.outstandingCommission) : 0, outstandingAfter: acc ? Number(acc.outstandingCommission) : 0, idempotent: true } as any;
      }
    }
    // Lock account row for update to prevent concurrent settlements
    await tx.$queryRaw`SELECT * FROM provider_cash_accounts WHERE provider_id = ${input.providerId} FOR UPDATE`;
    const account = await tx.providerCashAccount.findUnique({ where: { providerId: input.providerId } });
    if (!account) {
      const err: any = new Error('Cash account not found');
      err.status = 404;
      err.code = 'CASH_ACCOUNT_NOT_FOUND';
      throw err;
    }
    const outstanding = Number(account.outstandingCommission);
    if (input.amount > outstanding) {
      const err: any = new Error('Settlement amount exceeds outstanding liability');
      err.status = 422;
      err.code = 'SETTLEMENT_EXCEEDS_OUTSTANDING';
      throw err;
    }
    const newOutstanding = Math.round((outstanding - input.amount) * 100) / 100;
    const updatedAccount = await tx.providerCashAccount.update({
      where: { providerId: input.providerId },
      data: {
        outstandingCommission: newOutstanding,
        totalSettled: { increment: input.amount },
      },
    });
    const ledger = await tx.cashLedgerEntry.create({
      data: {
        providerId: input.providerId,
        grossAmount: 0,
        paymentMethod: 'cash',
        commissionRate: 0,
        commissionAmount: -input.amount, // negative to reduce liability
        type: 'SETTLEMENT',
        currency: 'ZAR',
        idempotencyKey: input.idempotencyKey ?? null,
        // Phase 1.5 foundation: settlement request is ledgered but requires verified payout confirmation in future payout engine.
        // This is NOT yet confirmed money received by Waasha — marked as unverified pending payout reconciliation.
        metadata: { settlementAmount: input.amount, verified: false, requiresVerification: true, status: 'PENDING_VERIFICATION' } as any,
      },
    });
    try {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId ?? input.providerId,
          action: 'CASH_SETTLEMENT',
          entityType: 'provider_cash_account',
          entityId: input.providerId,
          beforeJson: { outstandingBefore: outstanding } as any,
          afterJson: { outstandingAfter: newOutstanding, settlementAmount: input.amount } as any,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch {}
    return { account: updatedAccount, ledger, outstandingBefore: outstanding, outstandingAfter: newOutstanding };
  }, { isolationLevel: 'Serializable' } as any);
  return result;
}

export async function getCashAccount(providerId: string) {
  const account = await prisma.providerCashAccount.findUnique({ where: { providerId } });
  if (!account) {
    return {
      providerId,
      outstandingCommission: 0,
      totalCashGross: 0,
      totalCashCommission: 0,
      totalSettled: 0,
    };
  }
  return {
    providerId: account.providerId,
    outstandingCommission: Number(account.outstandingCommission),
    totalCashGross: Number(account.totalCashGross),
    totalCashCommission: Number(account.totalCashCommission),
    totalSettled: Number(account.totalSettled),
  };
}

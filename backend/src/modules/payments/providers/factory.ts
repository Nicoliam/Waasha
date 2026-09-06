import { PaymentProvider } from '../payment-provider.interface';
import { PaystackPaymentProvider } from './paystack.provider';

export function getPaymentProvider(gateway: string): PaymentProvider {
  if (gateway === 'paystack') return new PaystackPaymentProvider();
  throw new Error(`Unsupported payment gateway: ${gateway}`);
}

export function getProviderForMethod(method: string): PaymentProvider | null {
  // Only waasha_payment routes through Paystack; cash/eft are manual gateways.
  if (method === 'waasha_payment') return new PaystackPaymentProvider();
  return null;
}

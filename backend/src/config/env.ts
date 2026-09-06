import * as dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string, fallback: string | undefined, opts?: { minLength?: number; disallowPlaceholders?: string[] }): string {
  const val = process.env[name] ?? fallback;
  if (!val) {
    if (process.env.NODE_ENV === 'production') throw new Error(`Missing required env var: ${name}`);
    return fallback ?? '';
  }
  if (process.env.NODE_ENV === 'production') {
    if (opts?.minLength && val.length < opts.minLength) {
      throw new Error(`${name} must be at least ${opts.minLength} characters in production`);
    }
    if (opts?.disallowPlaceholders && opts.disallowPlaceholders.includes(val)) {
      throw new Error(`${name} must be changed from placeholder value in production`);
    }
  }
  return val;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://waasha:waasha_secret@localhost:3306/waasha',
  JWT_SECRET: requireEnv('JWT_SECRET', 'dev-jwt-secret-change-me', {
    minLength: 32,
    disallowPlaceholders: [
      'dev-jwt-secret-change-me',
      'dev-jwt-secret-change-me-local-only-not-for-production',
      'change-me-in-production-use-long-random-string',
      'REPLACE_WITH_LONG_RANDOM_SECRET_MIN_32_CHARS',
    ],
  }),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1h',
  CORS_ORIGIN: (process.env.CORS_ORIGIN ?? 'http://localhost:4200').split(','),
  // Paystack — isolated behind provider abstraction, never hard-coded
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY ?? '',
  PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET ?? process.env.PAYSTACK_SECRET_KEY ?? '',
} as const;

// Fail-fast in production if weak placeholder is in use (covers cases where requireEnv fallback bypassed in non-prod startup)
if (
  env.NODE_ENV === 'production' &&
  [
    'dev-jwt-secret-change-me',
    'dev-jwt-secret-change-me-local-only-not-for-production',
    'change-me-in-production-use-long-random-string',
    'REPLACE_WITH_LONG_RANDOM_SECRET_MIN_32_CHARS',
  ].includes(env.JWT_SECRET)
) {
  throw new Error('JWT_SECRET must be set to a strong value in production');
}

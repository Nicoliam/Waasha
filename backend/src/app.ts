import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import marketplaceRoutes from './modules/marketplace/marketplace.routes';
import providerRoutes from './modules/provider/provider.routes';
import authRoutes from './modules/auth/auth.routes';
import customerRoutes from './modules/customer/customer.routes';
import financeRoutes from './modules/finance/finance.routes';
import bookingRoutes from './modules/bookings/booking.routes';
import { errorHandler, notFound } from './middleware/error';

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health — Stage 3 Definition of Done
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.get('/ready', async (_req, res) => {
  // Liveness vs readiness: check DB connectivity without leaking details
  try {
    const { prisma } = await import('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ success: true, data: { status: 'ready' } });
  } catch {
    return res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database not ready' } });
  }
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/marketplace', marketplaceRoutes);
app.use('/api/v1/providers', providerRoutes);
app.use('/api/v1/finance', financeRoutes);
app.use('/api/v1/bookings', bookingRoutes);

// 404 + error
app.use(notFound);
app.use(errorHandler);

// Only listen when run directly (not when imported by tests)
if (require.main === module) {
  const port = env.PORT;
  app.listen(port, () => {
    console.log(`Waasha backend listening on :${port} (${env.NODE_ENV})`);
  });
}

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getAvailabilitySlots } from './availability.service';
import { createBooking, getBookingByIdForUser } from './booking.service';

const router = Router();

// All booking routes require auth
router.use(authMiddleware);

// GET /api/v1/bookings/availability?providerId=&serviceId=&date=YYYY-MM-DD
router.get('/availability', async (req: Request, res: Response) => {
  const schema = z.object({
    providerId: z.string().min(1),
    serviceId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const result = await getAvailabilitySlots(parsed.data);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load availability' } });
  }
});

// POST /api/v1/bookings
const createSchema = z.object({
  providerId: z.string().min(1),
  serviceId: z.string().min(1),
  scheduledStart: z.string().min(1), // ISO
  serviceLocationType: z.enum(['PROVIDER', 'CUSTOMER']).optional(),
  customerLocation: z.object({
    addressLine1: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    province: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locationType: z.string().optional().nullable(),
  }),
});

router.post('/', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }

  try {
    const booking = await createBooking({
      customerUserId: authUser.userId,
      providerId: parsed.data.providerId,
      serviceId: parsed.data.serviceId,
      scheduledStart: parsed.data.scheduledStart,
      serviceLocationType: parsed.data.serviceLocationType,
      customerLocation: parsed.data.customerLocation as any,
    });
    return res.status(201).json({ success: true, data: booking });
  } catch (err: any) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    }
    // Do not leak internals
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create booking' } });
  }
});

// GET /api/v1/bookings — list own bookings (customer view for immediate flow) — must be before :id
router.get('/', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const { prisma } = await import('../../config/prisma');
  const customerProfile = await prisma.customerProfile.findUnique({ where: { userId: authUser.userId } });
  const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId } });

  let bookings: any[] = [];
  if (customerProfile) {
    const cBookings = await prisma.booking.findMany({
      where: { customerId: customerProfile.id } as any,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { items: true, location: true },
    } as any);
    bookings = cBookings;
  }
  if (providerProfile && bookings.length === 0) {
    bookings = await prisma.booking.findMany({
      where: { providerId: providerProfile.id } as any,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { items: true, location: true },
    } as any);
  }

  return res.json({ success: true, data: bookings });
});

// GET /api/v1/bookings/:id — retrieve own booking (customer or provider)
router.get('/:id', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const booking = await getBookingByIdForUser(id, authUser.userId);
    return res.json({ success: true, data: booking });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load booking' } });
  }
});

export default router;

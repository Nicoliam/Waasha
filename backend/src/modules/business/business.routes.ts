import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth';

/**
 * Slice 15 — T2/T3 business-management routes.
 *
 * Mounted alongside the provider router under /api/v1/providers.
 * Every endpoint derives identity from the authenticated session;
 * client-supplied providerId/businessId/unitId/teamId/staffId are
 * selectors verified against the session scope — never authority.
 *
 * T2 (tier T2 only): /me/team...
 * T3 (tier T3 only): /me/business...
 * Booking assignment: /me/bookings/:id/assign|unassign (T2 owner/manager,
 * T3 owner/manager authority; never changes status/payment/completion).
 */

const router = Router();

router.use(authMiddleware);

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

function sendError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code ?? 'ERROR',
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

function param(req: Request, name: string): string {
  return String((req.params as Record<string, string>)[name] ?? '');
}

// ── Capabilities (tier gating for UI) ─────────────────────────────────

router.get('/me/capabilities', async (req: Request, res: Response) => {
  try {
    const { resolveBusinessScope } = await import('./business-scope');
    const scope = await resolveBusinessScope(req.authUser!.userId);
    return res.json({
      success: true,
      data: {
        tierCode: scope.tierCode,
        providerType: (scope.profile as any).providerType ?? null,
        hasTeam: !!scope.team,
        teamId: (scope.team as any)?.id ?? null,
        ownedBusinessIds: scope.ownedBusinessIds,
        ownedUnitIds: scope.ownedUnitIds,
        staffUnitIds: scope.staffUnitIds,
        teamMemberships: scope.teamMemberships.map((m) => ({ teamId: m.teamId, role: m.role })),
      },
    });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load capabilities');
  }
});

// ── T2 team ───────────────────────────────────────────────────────────

router.get('/me/team', async (req: Request, res: Response) => {
  try {
    const { getTeam } = await import('./team.service');
    return res.json({ success: true, data: await getTeam(req.authUser!.userId) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load team');
  }
});

router.post('/me/team', async (req: Request, res: Response) => {
  try {
    const { createTeam } = await import('./team.service');
    return res.status(201).json({ success: true, data: await createTeam(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to create team');
  }
});

router.patch('/me/team', async (req: Request, res: Response) => {
  try {
    const { updateTeam } = await import('./team.service');
    return res.json({ success: true, data: await updateTeam(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update team');
  }
});

router.get('/me/team/members', async (req: Request, res: Response) => {
  try {
    const { listMembers } = await import('./team.service');
    return res.json({ success: true, data: await listMembers(req.authUser!.userId) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load team members');
  }
});

router.post('/me/team/members', async (req: Request, res: Response) => {
  try {
    const { addMember } = await import('./team.service');
    return res.status(201).json({ success: true, data: await addMember(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to add team member');
  }
});

router.patch('/me/team/members/:memberId', async (req: Request, res: Response) => {
  try {
    const { updateMember } = await import('./team.service');
    return res.json({ success: true, data: await updateMember(req.authUser!.userId, param(req, 'memberId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update team member');
  }
});

router.delete('/me/team/members/:memberId', async (req: Request, res: Response) => {
  try {
    const { removeMember } = await import('./team.service');
    return res.json({ success: true, data: await removeMember(req.authUser!.userId, param(req, 'memberId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to remove team member');
  }
});

router.get('/me/team/invitations', async (req: Request, res: Response) => {
  try {
    const { listInvitations } = await import('./team.service');
    return res.json({ success: true, data: await listInvitations(req.authUser!.userId) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load invitations');
  }
});

router.post('/me/team/invitations', async (req: Request, res: Response) => {
  try {
    const { createInvitation } = await import('./team.service');
    return res.status(201).json({ success: true, data: await createInvitation(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to create invitation');
  }
});

router.post('/me/team/invitations/:invitationId/revoke', async (req: Request, res: Response) => {
  try {
    const { revokeInvitation } = await import('./team.service');
    return res.json({ success: true, data: await revokeInvitation(req.authUser!.userId, param(req, 'invitationId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to revoke invitation');
  }
});

router.post('/me/team/invitations/accept', async (req: Request, res: Response) => {
  const token = (req.body as any)?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'token is required' } });
  }
  try {
    const { acceptInvitation } = await import('./team.service');
    return res.json({ success: true, data: await acceptInvitation(req.authUser!.userId, token.trim(), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to accept invitation');
  }
});

// ── T3 business ───────────────────────────────────────────────────────

router.get('/me/business', async (req: Request, res: Response) => {
  try {
    const { listBusinesses } = await import('./business.service');
    return res.json({ success: true, data: await listBusinesses(req.authUser!.userId) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load businesses');
  }
});

router.post('/me/business', async (req: Request, res: Response) => {
  try {
    const { createBusiness } = await import('./business.service');
    return res.status(201).json({ success: true, data: await createBusiness(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to create business');
  }
});

router.get('/me/business/units/:unitId', async (req: Request, res: Response) => {
  try {
    const { getUnit } = await import('./business.service');
    return res.json({ success: true, data: await getUnit(req.authUser!.userId, param(req, 'unitId')) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load business unit');
  }
});

router.patch('/me/business/units/:unitId', async (req: Request, res: Response) => {
  try {
    const { updateUnit } = await import('./business.service');
    return res.json({ success: true, data: await updateUnit(req.authUser!.userId, param(req, 'unitId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update business unit');
  }
});

router.post('/me/business/units/:unitId/activate', async (req: Request, res: Response) => {
  try {
    const { setUnitActive } = await import('./business.service');
    return res.json({ success: true, data: await setUnitActive(req.authUser!.userId, param(req, 'unitId'), true, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to activate business unit');
  }
});

router.post('/me/business/units/:unitId/deactivate', async (req: Request, res: Response) => {
  try {
    const { setUnitActive } = await import('./business.service');
    return res.json({ success: true, data: await setUnitActive(req.authUser!.userId, param(req, 'unitId'), false, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to deactivate business unit');
  }
});

router.post('/me/business/units/:unitId/location', async (req: Request, res: Response) => {
  try {
    const { setUnitLocation } = await import('./business.service');
    return res.status(201).json({ success: true, data: await setUnitLocation(req.authUser!.userId, param(req, 'unitId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update unit location');
  }
});

router.put('/me/business/units/:unitId/categories', async (req: Request, res: Response) => {
  try {
    const { setUnitCategories } = await import('./business.service');
    return res.json({ success: true, data: await setUnitCategories(req.authUser!.userId, param(req, 'unitId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update unit categories');
  }
});

router.post('/me/business/units/:unitId/services/:serviceId/attach', async (req: Request, res: Response) => {
  try {
    const { attachService } = await import('./business.service');
    return res.json({ success: true, data: await attachService(req.authUser!.userId, param(req, 'unitId'), param(req, 'serviceId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to attach service');
  }
});

router.delete('/me/business/units/:unitId/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const { detachService } = await import('./business.service');
    return res.json({ success: true, data: await detachService(req.authUser!.userId, param(req, 'unitId'), param(req, 'serviceId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to detach service');
  }
});

router.patch('/me/business/staff/:staffId', async (req: Request, res: Response) => {
  try {
    const { updateStaff } = await import('./business.service');
    return res.json({ success: true, data: await updateStaff(req.authUser!.userId, param(req, 'staffId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update staff');
  }
});

router.delete('/me/business/staff/:staffId', async (req: Request, res: Response) => {
  try {
    const { removeStaff } = await import('./business.service');
    return res.json({ success: true, data: await removeStaff(req.authUser!.userId, param(req, 'staffId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to remove staff');
  }
});

router.post('/me/business/invitations/accept', async (req: Request, res: Response) => {
  const token = (req.body as any)?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'token is required' } });
  }
  try {
    const { acceptStaffInvitation } = await import('./business.service');
    return res.json({ success: true, data: await acceptStaffInvitation(req.authUser!.userId, token.trim(), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to accept invitation');
  }
});

router.get('/me/business/:businessId', async (req: Request, res: Response) => {
  try {
    const { getBusiness } = await import('./business.service');
    return res.json({ success: true, data: await getBusiness(req.authUser!.userId, param(req, 'businessId')) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load business');
  }
});

router.patch('/me/business/:businessId', async (req: Request, res: Response) => {
  try {
    const { updateBusiness } = await import('./business.service');
    return res.json({ success: true, data: await updateBusiness(req.authUser!.userId, param(req, 'businessId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to update business');
  }
});

router.get('/me/business/:businessId/units', async (req: Request, res: Response) => {
  try {
    const { listUnits } = await import('./business.service');
    return res.json({ success: true, data: await listUnits(req.authUser!.userId, param(req, 'businessId')) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load business units');
  }
});

router.post('/me/business/:businessId/units', async (req: Request, res: Response) => {
  try {
    const { createUnit } = await import('./business.service');
    return res.status(201).json({ success: true, data: await createUnit(req.authUser!.userId, param(req, 'businessId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to create business unit');
  }
});

router.get('/me/business/:businessId/staff', async (req: Request, res: Response) => {
  try {
    const { listStaff } = await import('./business.service');
    return res.json({ success: true, data: await listStaff(req.authUser!.userId, param(req, 'businessId')) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load staff');
  }
});

router.post('/me/business/:businessId/staff', async (req: Request, res: Response) => {
  try {
    const { addStaff } = await import('./business.service');
    return res.status(201).json({ success: true, data: await addStaff(req.authUser!.userId, param(req, 'businessId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to add staff');
  }
});

router.get('/me/business/:businessId/invitations', async (req: Request, res: Response) => {
  try {
    const { listStaffInvitations } = await import('./business.service');
    return res.json({ success: true, data: await listStaffInvitations(req.authUser!.userId, param(req, 'businessId')) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to load invitations');
  }
});

router.post('/me/business/:businessId/invitations', async (req: Request, res: Response) => {
  try {
    const { createStaffInvitation } = await import('./business.service');
    return res.status(201).json({ success: true, data: await createStaffInvitation(req.authUser!.userId, param(req, 'businessId'), (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to create invitation');
  }
});

router.post('/me/business/:businessId/invitations/:invitationId/revoke', async (req: Request, res: Response) => {
  try {
    const { revokeStaffInvitation } = await import('./business.service');
    return res.json({ success: true, data: await revokeStaffInvitation(req.authUser!.userId, param(req, 'businessId'), param(req, 'invitationId'), ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to revoke invitation');
  }
});

// ── Booking assignment ────────────────────────────────────────────────

router.post('/me/bookings/:id/assign', async (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { assignBooking } = await import('./booking-assignment.service');
    return res.json({ success: true, data: await assignBooking(req.authUser!.userId, id, (req.body ?? {}) as Record<string, unknown>, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to assign booking');
  }
});

router.post('/me/bookings/:id/unassign', async (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { unassignBooking } = await import('./booking-assignment.service');
    return res.json({ success: true, data: await unassignBooking(req.authUser!.userId, id, ctxOf(req)) });
  } catch (e: any) {
    return sendError(res, e, 'Failed to unassign booking');
  }
});

export default router;

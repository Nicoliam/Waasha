import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma';

/**
 * Slice 16 — Admin authorization (session-derived, DB-verified).
 *
 * The ADMIN privilege is resolved from the database (user_roles → roles)
 * on every request — never from client-supplied ids, query params, or body
 * fields, and never from the JWT `roles` claim alone (a token issued before
 * a grant/revocation would otherwise be stale authority).
 *
 * Must run after authMiddleware (requires req.authUser).
 *   no auth        → 401
 *   non-admin role → 403
 *   admin          → next()
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authUser = req.authUser;
  if (!authUser) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  let memberships: Array<{ role: { code: string } }>;
  try {
    memberships = (await (prisma.userRole as any).findMany({
      where: { userId: authUser.userId },
      include: { role: true },
    })) as Array<{ role: { code: string } }>;
  } catch {
    return res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Authorization temporarily unavailable' },
    });
  }
  const isAdmin = Array.isArray(memberships) && memberships.some((m) => m?.role?.code === 'ADMIN');
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin privileges required' },
    });
  }
  next();
}

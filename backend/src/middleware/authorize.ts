import { Request, Response, NextFunction } from 'express';

/**
 * Require authenticated — ensures authMiddleware ran.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  next();
}

/**
 * RETIRED (Slice 19) — JWT-role trust pattern.
 *
 * This middleware authorized from `req.authUser.roles` (the JWT `roles`
 * claim). A token issued before a grant/revocation carries stale authority,
 * so JWT claims must NEVER be sufficient for authorization. The canonical
 * rule is: session identifies the user → database user_roles → roles
 * decides authority (see modules/admin/admin-auth.ts `requireAdmin`).
 *
 * There are zero callers as of Slice 19. The stub stays fail-closed (always
 * 403) so any accidental reuse can never grant authority. Do NOT revive
 * JWT-claim authorization — use `requireAdmin` or a session-derived,
 * DB-verified check instead.
 */
export function requireRole(..._allowedRoles: string[]) {
  void _allowedRoles;
  return (req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (!req.authUser) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Retired authorization path' } });
  };
}

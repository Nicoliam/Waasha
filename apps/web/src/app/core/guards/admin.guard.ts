import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Slice 16 — admin route guard (web).
 * Requires authentication AND the ADMIN role from the server-derived
 * /me profile. This is a UX gate only — every /api/v1/admin endpoint
 * re-enforces requireAdmin server-side regardless of UI state.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    router.navigate(['/auth/login']);
    return false;
  }
  const snapshot = auth.snapshot();
  if (snapshot && Array.isArray(snapshot.roles) && snapshot.roles.includes('ADMIN')) return true;
  // Roles load asynchronously via fetchMe(); allow the component shell to
  // render its own "checking access" state only when the snapshot is empty.
  // If a snapshot exists without ADMIN, deny immediately.
  if (snapshot) {
    router.navigate(['/']);
    return false;
  }
  router.navigate(['/auth/login']);
  return false;
};

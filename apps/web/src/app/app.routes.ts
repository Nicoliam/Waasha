import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  // Customer discovery — primary home per Phase 1 (no auth required for marketplace browsing)
  { path: '', loadComponent: () => import('./features/discovery/discovery.component').then((m) => m.DiscoveryComponent) },
  { path: 'discovery', loadComponent: () => import('./features/discovery/discovery.component').then((m) => m.DiscoveryComponent) },
  { path: 'marketplace', loadComponent: () => import('./features/discovery/discovery.component').then((m) => m.DiscoveryComponent) },
  // Slice 2 canonical provider + service detail
  {
    path: 'marketplace/provider/:providerId',
    loadComponent: () => import('./features/provider/provider-profile.component').then((m) => m.ProviderProfileComponent),
  },
  {
    path: 'marketplace/provider/:providerId/service/:serviceId',
    loadComponent: () => import('./features/provider/service-detail.component').then((m) => m.ServiceDetailComponent),
  },
  {
    path: 'marketplace/provider/:providerId/service/:serviceId/book',
    loadComponent: () => import('./features/booking/booking.component').then((m) => m.BookingComponent),
  },
  // Legacy alias preserved for Phase 1 deep links
  {
    path: 'providers/:id',
    loadComponent: () => import('./features/provider/provider-profile.component').then((m) => m.ProviderProfileComponent),
  },
  // Slice 5 — provider booking management (provider auth required)
  {
    path: 'provider/bookings',
    loadComponent: () => import('./features/provider-bookings/provider-inbox.component').then((m) => m.ProviderInboxComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/bookings/:id',
    loadComponent: () => import('./features/provider-bookings/provider-booking-detail.component').then((m) => m.ProviderBookingDetailComponent),
    canActivate: [authGuard],
  },
  // Slice 9 — provider service catalogue management (provider auth required)
  {
    path: 'provider/services',
    loadComponent: () => import('./features/provider-services/provider-services.component').then((m) => m.ProviderServicesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/services/new',
    loadComponent: () =>
      import('./features/provider-services/provider-service-editor.component').then((m) => m.ProviderServiceEditorComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/services/:serviceId',
    loadComponent: () =>
      import('./features/provider-services/provider-service-editor.component').then((m) => m.ProviderServiceEditorComponent),
    canActivate: [authGuard],
  },
  // Slice 10 — provider profile management (provider auth required)
  {
    path: 'provider/profile',
    loadComponent: () => import('./features/provider-profile/provider-profile.component').then((m) => m.ProviderProfileComponent),
    canActivate: [authGuard],
  },
  // Slice 8 — provider availability & scheduling (provider auth required)
  {
    path: 'provider/availability',
    loadComponent: () =>
      import('./features/provider-availability/provider-availability.component').then((m) => m.ProviderAvailabilityComponent),
    canActivate: [authGuard],
  },
  // Slice 6 — customer booking management (customer auth required, read-only)
  {
    path: 'bookings',
    loadComponent: () => import('./features/bookings/my-bookings.component').then((m) => m.MyBookingsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'bookings/:id',
    loadComponent: () => import('./features/bookings/my-booking-detail.component').then((m) => m.MyBookingDetailComponent),
    canActivate: [authGuard],
  },
  // Slice 14 — provider POS & inventory (provider auth required, same /api/v1/pos API as mobile)
  {
    path: 'provider/pos',
    loadComponent: () => import('./features/provider-pos/pos.component').then((m) => m.ProviderPosComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/pos/sales/:id',
    loadComponent: () => import('./features/provider-pos/pos.component').then((m) => m.ProviderPosComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/inventory',
    loadComponent: () => import('./features/provider-inventory/inventory.component').then((m) => m.ProviderInventoryComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/inventory/:id',
    loadComponent: () => import('./features/provider-inventory/inventory.component').then((m) => m.ProviderInventoryComponent),
    canActivate: [authGuard],
  },
  // Slice 15 — T2/T3 business management (provider auth required, tier-gated server-side)
  {
    path: 'provider/team',
    loadComponent: () => import('./features/business/team.component').then((m) => m.TeamComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/team/members',
    loadComponent: () => import('./features/business/team-members.component').then((m) => m.TeamMembersComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business',
    loadComponent: () => import('./features/business/business-dashboard.component').then((m) => m.BusinessDashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/units',
    loadComponent: () => import('./features/business/business-units.component').then((m) => m.BusinessUnitsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/units/:id',
    loadComponent: () =>
      import('./features/business/business-unit-detail.component').then((m) => m.BusinessUnitDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/staff',
    loadComponent: () => import('./features/business/business-staff.component').then((m) => m.BusinessStaffComponent),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/categories',
    loadComponent: () =>
      import('./features/business/business-categories.component').then((m) => m.BusinessCategoriesComponent),
    canActivate: [authGuard],
  },
  // Slice 17 — training-centre partner workspace (partner auth required,
  // session-derived membership server-side; same /api/v1/partners API as mobile)
  {
    path: 'partner/dashboard',
    loadComponent: () => import('./features/partner/partner-dashboard.component').then((m) => m.PartnerDashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'partner/referrals',
    loadComponent: () => import('./features/partner/partner-referrals.component').then((m) => m.PartnerReferralsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'partner/providers',
    loadComponent: () => import('./features/partner/partner-providers.component').then((m) => m.PartnerProvidersComponent),
    canActivate: [authGuard],
  },
  {
    path: 'partner/earnings',
    loadComponent: () => import('./features/partner/partner-earnings.component').then((m) => m.PartnerEarningsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'partner/profile',
    loadComponent: () => import('./features/partner/partner-profile.component').then((m) => m.PartnerProfileComponent),
    canActivate: [authGuard],
  },
  { path: 'partner', redirectTo: 'partner/dashboard', pathMatch: 'full' },
  // Slice 7 — in-app notifications (auth required)
  {
    path: 'notifications',
    loadComponent: () => import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
    canActivate: [authGuard],
  },
  // Slice 16 — Admin Platform (secure web control plane; adminGuard is a UX
  // gate only — every /api/v1/admin endpoint re-enforces requireAdmin).
  {
    path: 'admin/dashboard',
    loadComponent: () => import('./features/admin/admin-dashboard.component').then((m) => m.AdminDashboardComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/users',
    loadComponent: () => import('./features/admin/admin-users.component').then((m) => m.AdminUsersComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/providers',
    loadComponent: () => import('./features/admin/admin-providers.component').then((m) => m.AdminProvidersComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/businesses',
    loadComponent: () => import('./features/admin/admin-businesses.component').then((m) => m.AdminBusinessesComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/bookings',
    loadComponent: () => import('./features/admin/admin-bookings.component').then((m) => m.AdminBookingsComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/finance',
    loadComponent: () => import('./features/admin/admin-finance.component').then((m) => m.AdminFinanceComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/settings',
    loadComponent: () => import('./features/admin/admin-settings.component').then((m) => m.AdminSettingsComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/audit',
    loadComponent: () => import('./features/admin/admin-audit.component').then((m) => m.AdminAuditComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/ops',
    loadComponent: () => import('./features/admin/admin-ops.component').then((m) => m.AdminOpsComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/partners',
    loadComponent: () => import('./features/admin/admin-partners.component').then((m) => m.AdminPartnersComponent),
    canActivate: [adminGuard],
  },
  { path: 'admin', redirectTo: 'admin/dashboard', pathMatch: 'full' },
  { path: 'auth/login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  { path: 'auth/register', loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent) },
  { path: 'me', loadComponent: () => import('./features/auth/me.component').then((m) => m.MeComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

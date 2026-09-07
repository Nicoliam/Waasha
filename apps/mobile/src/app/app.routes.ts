import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/discovery/discovery.page').then((m) => m.DiscoveryPage) },
  { path: 'discovery', loadComponent: () => import('./features/discovery/discovery.page').then((m) => m.DiscoveryPage) },
  { path: 'marketplace', loadComponent: () => import('./features/discovery/discovery.page').then((m) => m.DiscoveryPage) },
  {
    path: 'marketplace/provider/:providerId',
    loadComponent: () => import('./features/provider/provider-profile.page').then((m) => m.ProviderProfilePage),
  },
  {
    path: 'marketplace/provider/:providerId/service/:serviceId',
    loadComponent: () => import('./features/provider/service-detail.page').then((m) => m.MobileServiceDetailPage),
  },
  {
    path: 'marketplace/provider/:providerId/service/:serviceId/book',
    loadComponent: () => import('./features/booking/booking.page').then((m) => m.MobileBookingPage),
  },
  { path: 'providers/:id', loadComponent: () => import('./features/provider/provider-profile.page').then((m) => m.ProviderProfilePage) },
  // Slice 5 — provider booking management (provider auth required, same backend APIs as web)
  {
    path: 'provider/bookings',
    loadComponent: () => import('./features/provider-bookings/provider-inbox.page').then((m) => m.ProviderInboxPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/bookings/:id',
    loadComponent: () => import('./features/provider-bookings/provider-booking-detail.page').then((m) => m.ProviderBookingDetailPage),
    canActivate: [authGuard],
  },
  // Slice 9 — provider service catalogue management (provider auth required, same backend APIs as web)
  {
    path: 'provider/services',
    loadComponent: () => import('./features/provider-services/provider-services.page').then((m) => m.ProviderServicesPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/services/new',
    loadComponent: () =>
      import('./features/provider-services/provider-service-editor.page').then((m) => m.ProviderServiceEditorPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/services/:serviceId',
    loadComponent: () =>
      import('./features/provider-services/provider-service-editor.page').then((m) => m.ProviderServiceEditorPage),
    canActivate: [authGuard],
  },
  // Slice 10 — provider profile management (provider auth required, same backend APIs as web)
  {
    path: 'provider/profile',
    loadComponent: () => import('./features/provider-profile/provider-profile.page').then((m) => m.ProviderProfilePage),
    canActivate: [authGuard],
  },
  // Slice 8 — provider availability & scheduling (provider auth required, same backend APIs as web)
  {
    path: 'provider/availability',
    loadComponent: () =>
      import('./features/provider-availability/provider-availability.page').then((m) => m.ProviderAvailabilityPage),
    canActivate: [authGuard],
  },
  // Slice 6 — customer booking management (customer auth required, read-only, same backend APIs as web)
  {
    path: 'bookings',
    loadComponent: () => import('./features/bookings/my-bookings.page').then((m) => m.MyBookingsPage),
    canActivate: [authGuard],
  },
  {
    path: 'bookings/:id',
    loadComponent: () => import('./features/bookings/my-booking-detail.page').then((m) => m.MyBookingDetailPage),
    canActivate: [authGuard],
  },
  // Slice 14 — provider POS & inventory (provider auth required, same backend APIs as web)
  {
    path: 'provider/pos',
    loadComponent: () => import('./features/provider-pos/pos.page').then((m) => m.ProviderPosPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/pos/sales/:id',
    loadComponent: () => import('./features/provider-pos/pos.page').then((m) => m.ProviderPosPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/inventory',
    loadComponent: () => import('./features/provider-inventory/inventory.page').then((m) => m.ProviderInventoryPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/inventory/:id',
    loadComponent: () => import('./features/provider-inventory/inventory.page').then((m) => m.ProviderInventoryPage),
    canActivate: [authGuard],
  },
  // Slice 15 — T2/T3 business management (provider auth required, same backend APIs as web)
  {
    path: 'provider/team',
    loadComponent: () => import('./features/business/team.page').then((m) => m.TeamPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/team/members',
    loadComponent: () => import('./features/business/team-members.page').then((m) => m.TeamMembersPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business',
    loadComponent: () => import('./features/business/business-dashboard.page').then((m) => m.BusinessDashboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/units',
    loadComponent: () => import('./features/business/business-units.page').then((m) => m.BusinessUnitsPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/units/:id',
    loadComponent: () =>
      import('./features/business/business-unit-detail.page').then((m) => m.BusinessUnitDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/staff',
    loadComponent: () => import('./features/business/business-staff.page').then((m) => m.BusinessStaffPage),
    canActivate: [authGuard],
  },
  {
    path: 'provider/business/categories',
    loadComponent: () =>
      import('./features/business/business-categories.page').then((m) => m.BusinessCategoriesPage),
    canActivate: [authGuard],
  },
  // Slice 17 — training-centre partner workspace (same /api/v1/partners
  // API, same session-derived authorization, same business rules as web;
  // no mobile-only logic; mutations blocked offline, never queued)
  {
    path: 'partner/dashboard',
    loadComponent: () => import('./features/partner/partner-dashboard.page').then((m) => m.PartnerDashboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'partner/referrals',
    loadComponent: () => import('./features/partner/partner-referrals.page').then((m) => m.PartnerReferralsPage),
    canActivate: [authGuard],
  },
  {
    path: 'partner/providers',
    loadComponent: () => import('./features/partner/partner-providers.page').then((m) => m.PartnerProvidersPage),
    canActivate: [authGuard],
  },
  {
    path: 'partner/earnings',
    loadComponent: () => import('./features/partner/partner-earnings.page').then((m) => m.PartnerEarningsPage),
    canActivate: [authGuard],
  },
  {
    path: 'partner/profile',
    loadComponent: () => import('./features/partner/partner-profile.page').then((m) => m.PartnerProfilePage),
    canActivate: [authGuard],
  },
  { path: 'partner', redirectTo: 'partner/dashboard', pathMatch: 'full' },
  // Slice 7 — in-app notifications (auth required, same backend APIs as web)
  {
    path: 'notifications',
    loadComponent: () => import('./features/notifications/notifications.page').then((m) => m.NotificationsPage),
    canActivate: [authGuard],
  },
  { path: 'auth/login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  { path: 'auth/register', loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent) },
  { path: 'me', loadComponent: () => import('./features/auth/me.component').then((m) => m.MeComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

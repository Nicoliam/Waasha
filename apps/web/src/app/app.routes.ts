import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
  // Slice 7 — in-app notifications (auth required)
  {
    path: 'notifications',
    loadComponent: () => import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
    canActivate: [authGuard],
  },
  { path: 'auth/login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  { path: 'auth/register', loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent) },
  { path: 'me', loadComponent: () => import('./features/auth/me.component').then((m) => m.MeComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

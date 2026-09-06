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
  { path: 'auth/login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  { path: 'auth/register', loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent) },
  { path: 'me', loadComponent: () => import('./features/auth/me.component').then((m) => m.MeComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

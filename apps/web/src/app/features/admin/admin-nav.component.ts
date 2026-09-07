import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Slice 16 — admin section navigation (web).
 * Deliberately operational in appearance: clarity over marketing.
 * Never resembles the customer marketplace.
 */
@Component({
  selector: 'waasha-admin-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="wa-adminnav" aria-label="Admin sections">
      <a routerLink="/admin/dashboard" routerLinkActive="active">Dashboard</a>
      <a routerLink="/admin/users" routerLinkActive="active">Users</a>
      <a routerLink="/admin/providers" routerLinkActive="active">Providers</a>
      <a routerLink="/admin/businesses" routerLinkActive="active">Businesses</a>
      <a routerLink="/admin/bookings" routerLinkActive="active">Bookings</a>
      <a routerLink="/admin/finance" routerLinkActive="active">Finance</a>
      <a routerLink="/admin/settings" routerLinkActive="active">Settings</a>
      <a routerLink="/admin/audit" routerLinkActive="active">Audit</a>
      <a routerLink="/admin/ops" routerLinkActive="active">Notify &amp; Media</a>
      <a routerLink="/admin/partners" routerLinkActive="active">Partners</a>
    </nav>
  `,
})
export class AdminNavComponent {}

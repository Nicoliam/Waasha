import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';

/** Conservative polling interval for the unread badge (hidden-tab aware). */
export const UNREAD_POLL_INTERVAL_MS = 120_000;

@Component({
  selector: 'waasha-mobile-notification-bell',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a *ngIf="visible" routerLink="/notifications" class="wa-bell" aria-label="Notifications">
      <span class="wa-bell__icon" aria-hidden="true">◉</span>
      <span class="wa-bell__label">Alerts</span>
      <span *ngIf="unread > 0" class="wa-bell__badge" role="status" aria-label="{{ unread }} unread notifications">{{ unreadDisplay }}</span>
    </a>
  `,
  styles: [`
    .wa-bell { position:relative; display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--waasha-navy); text-decoration:none; padding:6px 10px; border-radius:10px; }
    .wa-bell:hover { background:#F1F5F9; }
    .wa-bell__icon { font-size:15px; color:var(--waasha-teal); line-height:1; }
    .wa-bell__badge { min-width:20px; height:20px; padding:0 6px; border-radius:999px; background:#DC2626; color:white; font-size:11px; font-weight:800; display:inline-flex; align-items:center; justify-content:center; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private sub: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  unread = 0;
  visible = false;

  get unreadDisplay(): string {
    return this.unread > 99 ? '99+' : String(this.unread);
  }

  ngOnInit(): void {
    this.visible = this.auth.isAuthenticated();
    if (!this.visible) return;
    this.refresh();
    // Refresh on navigation (cheap count query) + conservative polling.
    this.sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.refresh());
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.refresh();
    }, UNREAD_POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  private refresh(): void {
    this.notifications.unreadCount().subscribe({
      next: (res) => {
        this.unread = res.data?.unreadCount ?? 0;
      },
      error: () => {
        // Badge stays at last known value; never fabricate a count.
      },
    });
  }
}

import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { WaashaLogoComponent } from './shared/components/waasha-logo.component';
import { NotificationBellComponent } from './shared/components/notifications/notification-bell.component';
import { SyncStatusComponent } from './shared/components/sync/sync-status.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, WaashaLogoComponent, NotificationBellComponent, SyncStatusComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}

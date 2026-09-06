import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { WaashaLogoComponent } from './shared/components/waasha-logo.component';
import { NotificationBellComponent } from './shared/components/notifications/notification-bell.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, WaashaLogoComponent, NotificationBellComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}

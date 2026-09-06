import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProviderAvailabilityService } from '../../core/services/provider-availability.service';
import {
  DAY_NAMES,
  AvailabilityRuleDto,
  AvailabilityExceptionDto,
  ScheduleConflictDto,
  groupRulesByDay,
  validateWindow,
  findOverlap,
  validateExceptionDate,
  isValidTime,
  exceptionLabel,
  conflictMessage,
  offlineBlockedMessage,
  apiErrorMessage,
} from './provider-availability.utils';

/**
 * Slice 8 (mobile) — Provider scheduling page.
 * Same API, same business rules, same error behavior as web.
 * No mobile-only behavior; controls are touch-friendly (large tap targets).
 */
@Component({
  selector: 'waasha-mobile-provider-availability',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-avail wa-avail--mobile">
      <header class="wa-avail__head">
        <div>
          <h1 class="wa-title">Availability</h1>
          <p class="wa-sub">Weekly hours and exceptions. Future slots follow this schedule; existing bookings are never moved or cancelled.</p>
          <p class="wa-tz" *ngIf="timezone">Timezone: <strong class="wa-mono">{{ timezone }}</strong></p>
        </div>
        <a routerLink="/provider/bookings" class="wa-btn wa-btn-ghost wa-btn--touch">Inbox</a>
      </header>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading your schedule…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ unauthorized ? 'Access denied' : "Couldn't load schedule" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--touch" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--touch">Log in</a>
        </div>
      </div>

      <div *ngIf="offline" class="wa-card wa-offline" role="alert">
        <p class="wa-offline__title">Offline — changes disabled</p>
        <p class="wa-offline__msg">{{ offlineMessage }}</p>
      </div>

      <div *ngIf="conflicts.length > 0 && !loading" class="wa-card wa-conflicts" role="alert">
        <p class="wa-conflicts__title">Conflicts with existing bookings</p>
        <ul>
          <li *ngFor="let c of conflicts">{{ conflictText(c) }}</li>
        </ul>
      </div>

      <div *ngIf="!loading && !loadError">
        <section class="wa-card" aria-label="Weekly schedule">
          <h2 class="wa-h2">Weekly hours</h2>
          <p class="wa-hint" *ngIf="rules.length === 0">No hours set yet — customers cannot book until you add working hours.</p>
          <div *ngFor="let day of days; let d = index" class="wa-day">
            <div class="wa-day__head">
              <strong>{{ day }}</strong>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--touch" [disabled]="offline || saving" (click)="startAdd(d)">Add hours</button>
            </div>
            <ul *ngIf="grouped[d].length > 0" class="wa-windows">
              <li *ngFor="let w of grouped[d]" class="wa-window wa-window--touch">
                <span class="wa-mono">{{ w.startTime }}–{{ w.endTime }}</span>
                <span class="wa-badge" [attr.data-active]="w.isActive">{{ w.isActive ? 'Active' : 'Paused' }}</span>
                <button type="button" class="wa-btn wa-btn-ghost wa-btn--touch" [disabled]="offline || saving" (click)="toggleRule(w)">
                  {{ w.isActive ? 'Pause' : 'Resume' }}
                </button>
                <button type="button" class="wa-btn wa-btn-ghost wa-btn--touch" [disabled]="offline || saving" (click)="removeRule(w)">Remove</button>
              </li>
            </ul>
            <p *ngIf="grouped[d].length === 0" class="wa-muted">Unavailable</p>
            <div *ngIf="addingDay === d" class="wa-add">
              <label>Start <input type="time" [(ngModel)]="newStart" aria-label="Start time" /></label>
              <label>End <input type="time" [(ngModel)]="newEnd" aria-label="End time" /></label>
              <div class="wa-add__actions">
                <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--touch" [disabled]="offline || saving" (click)="saveNewWindow(d)">Save</button>
                <button type="button" class="wa-btn wa-btn-ghost wa-btn--touch" (click)="cancelAdd()">Cancel</button>
              </div>
            </div>
          </div>
        </section>

        <section class="wa-card" aria-label="Exceptions">
          <h2 class="wa-h2">Exceptions & holidays</h2>
          <ul *ngIf="exceptions.length > 0" class="wa-windows">
            <li *ngFor="let e of exceptions" class="wa-window wa-window--touch">
              <span>{{ exceptionText(e) }}</span>
              <span *ngIf="e.reason" class="wa-muted">— {{ e.reason }}</span>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--touch" [disabled]="offline || saving" (click)="removeException(e)">Remove</button>
            </li>
          </ul>
          <p *ngIf="exceptions.length === 0" class="wa-muted">No upcoming exceptions.</p>
          <div class="wa-add">
            <label>Date <input type="date" [(ngModel)]="excDate" aria-label="Exception date" /></label>
            <label>
              Type
              <select [(ngModel)]="excKind" aria-label="Exception type">
                <option value="FULL_DAY">Closed all day</option>
                <option value="BLOCKED">Blocked period</option>
                <option value="CUSTOM_HOURS">Special hours</option>
              </select>
            </label>
            <ng-container *ngIf="excKind !== 'FULL_DAY'">
              <label>Start <input type="time" [(ngModel)]="excStart" aria-label="Exception start" /></label>
              <label>End <input type="time" [(ngModel)]="excEnd" aria-label="Exception end" /></label>
            </ng-container>
            <label>Reason (optional) <input type="text" [(ngModel)]="excReason" maxlength="500" placeholder="Holiday, leave…" /></label>
            <div class="wa-add__actions">
              <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--touch" [disabled]="offline || saving" (click)="saveException()">Add exception</button>
            </div>
          </div>
        </section>

        <section class="wa-card" aria-label="Timezone">
          <h2 class="wa-h2">Timezone</h2>
          <div class="wa-add">
            <label>IANA timezone <input type="text" [(ngModel)]="tzEdit" aria-label="Timezone" placeholder="Africa/Johannesburg" /></label>
            <div class="wa-add__actions">
              <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--touch" [disabled]="offline || saving" (click)="saveTimezone()">Save timezone</button>
            </div>
          </div>
        </section>

        <div *ngIf="saving" class="wa-card wa-loading" role="status">Saving…</div>
        <div *ngIf="savedMessage" class="wa-card wa-saved" role="status">{{ savedMessage }}</div>
        <div *ngIf="formError" class="wa-card wa-error" role="alert">
          <p class="wa-error__title">Couldn't save</p>
          <p class="wa-error__msg">{{ formError }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .wa-btn--touch {
        min-height: 44px;
        min-width: 44px;
        padding: 10px 16px;
      }
      .wa-window--touch {
        padding: 12px 0;
      }
      .wa-add input,
      .wa-add select {
        min-height: 44px;
        font-size: 16px;
      }
    `,
  ],
})
export class ProviderAvailabilityPage implements OnInit {
  private readonly api = inject(ProviderAvailabilityService);

  days = [...DAY_NAMES];
  grouped: AvailabilityRuleDto[][] = Array.from({ length: 7 }, () => []);
  rules: AvailabilityRuleDto[] = [];
  exceptions: AvailabilityExceptionDto[] = [];
  conflicts: ScheduleConflictDto[] = [];
  timezone = '';

  loading = true;
  saving = false;
  loadError: string | null = null;
  unauthorized = false;
  formError: string | null = null;
  savedMessage: string | null = null;
  offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  offlineMessage = offlineBlockedMessage();

  addingDay: number | null = null;
  newStart = '08:00';
  newEnd = '17:00';

  excDate = '';
  excKind: 'FULL_DAY' | 'BLOCKED' | 'CUSTOM_HOURS' = 'FULL_DAY';
  excStart = '08:00';
  excEnd = '12:00';
  excReason = '';
  tzEdit = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.api.getSchedule().subscribe({
      next: (res) => {
        this.rules = (res.data?.rules ?? []) as AvailabilityRuleDto[];
        this.grouped = groupRulesByDay(this.rules);
        this.exceptions = (res.data?.exceptions ?? []) as AvailabilityExceptionDto[];
        this.timezone = res.data?.timezone ?? '';
        this.tzEdit = this.timezone;
        this.loading = false;
        this.refreshConflicts();
      },
      error: (e) => {
        const parsed = apiErrorMessage(e);
        this.loadError = parsed.message;
        this.unauthorized = parsed.unauthorized;
        this.loading = false;
      },
    });
  }

  refreshConflicts(): void {
    this.api.getConflicts().subscribe({
      next: (res) => {
        this.conflicts = (res.data?.conflicts ?? []) as ScheduleConflictDto[];
      },
      error: () => {
        this.conflicts = [];
      },
    });
  }

  conflictText(c: ScheduleConflictDto): string {
    return conflictMessage(c);
  }

  exceptionText(e: AvailabilityExceptionDto): string {
    return exceptionLabel(e);
  }

  startAdd(day: number): void {
    this.addingDay = day;
    this.formError = null;
    this.savedMessage = null;
  }

  cancelAdd(): void {
    this.addingDay = null;
  }

  saveNewWindow(day: number): void {
    const err = validateWindow(day, this.newStart, this.newEnd);
    if (err) {
      this.formError = err;
      return;
    }
    if (findOverlap(this.grouped[day], { startTime: this.newStart, endTime: this.newEnd })) {
      this.formError = 'This window overlaps existing hours for the day.';
      return;
    }
    this.mutate(this.api.createRule({ dayOfWeek: day, startTime: this.newStart, endTime: this.newEnd }), 'Hours saved.');
    this.addingDay = null;
  }

  toggleRule(w: AvailabilityRuleDto): void {
    this.mutate(this.api.updateRule(w.id, { isActive: !w.isActive }), w.isActive ? 'Hours paused.' : 'Hours resumed.');
  }

  removeRule(w: AvailabilityRuleDto): void {
    this.mutate(this.api.deleteRule(w.id), 'Hours removed.');
  }

  saveException(): void {
    const dateErr = validateExceptionDate(this.excDate);
    if (dateErr) {
      this.formError = dateErr;
      return;
    }
    if (this.excKind !== 'FULL_DAY' && !isValidTime(this.excStart)) {
      this.formError = 'Exception start must use HH:mm.';
      return;
    }
    if (this.excKind !== 'FULL_DAY' && !isValidTime(this.excEnd)) {
      this.formError = 'Exception end must use HH:mm.';
      return;
    }
    const body: any = { date: this.excDate, kind: this.excKind };
    if (this.excKind !== 'FULL_DAY') {
      body.startTime = this.excStart;
      body.endTime = this.excEnd;
    }
    if (this.excReason.trim()) body.reason = this.excReason.trim();
    this.mutate(this.api.createException(body), 'Exception saved.');
  }

  removeException(e: AvailabilityExceptionDto): void {
    this.mutate(this.api.deleteException(e.id), 'Exception removed.');
  }

  saveTimezone(): void {
    if (!this.tzEdit.trim()) {
      this.formError = 'Timezone is required.';
      return;
    }
    this.mutate(this.api.updateTimezone(this.tzEdit.trim()), 'Timezone saved.');
  }

  private mutate(obs: { subscribe: (o: { next: () => void; error: (e: any) => void }) => void }, okMessage: string): void {
    if (this.offline) {
      this.formError = this.offlineMessage;
      return;
    }
    this.saving = true;
    this.formError = null;
    this.savedMessage = null;
    obs.subscribe({
      next: () => {
        this.saving = false;
        this.savedMessage = okMessage;
        this.load();
      },
      error: (e) => {
        const parsed = apiErrorMessage(e?.error ?? e);
        this.saving = false;
        this.formError = parsed.message;
      },
    });
  }
}

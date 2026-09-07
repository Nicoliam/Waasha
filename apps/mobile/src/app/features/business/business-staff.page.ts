import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import {
  canManageBusiness,
  invitationExpiryLabel,
  mutationErrorMessage,
  offlineMessage,
  roleLabel,
  statusLabel,
} from './business.utils';

/**
 * Slice 15 — T3 staff management (mobile).
 * Staff are assigned to units, activated/deactivated, and invited via
 * scoped single-use tokens. No payroll, salary or commission logic —
 * those are explicit non-goals.
 */
@Component({
  selector: 'waasha-mobile-business-staff',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-staff">
      <header class="wa-staff__head">
        <div>
          <h1 class="wa-title">Business staff</h1>
          <p class="wa-sub">Assign staff to units. Removing staff deactivates them; history is preserved.</p>
        </div>
        <a routerLink="/provider/business" class="wa-btn wa-btn-ghost wa-btn--sm">Business</a>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading staff…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load staff</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Select business">
        <div class="wa-grid">
          <label class="wa-field"><span>Business</span>
            <select [(ngModel)]="businessId" (ngModelChange)="reload()" aria-label="Select business">
              <option *ngFor="let b of businesses" [value]="b.id">{{ b.displayName }}</option>
            </select>
          </label>
          <label class="wa-field"><span>Unit (for assignment)</span>
            <select [(ngModel)]="unitId" aria-label="Select unit">
              <option value="">No unit</option>
              <option *ngFor="let u of units" [value]="u.id">{{ u.name }}</option>
            </select>
          </label>
        </div>
      </section>

      <section *ngIf="!loading && !loadError && businessId" class="wa-card" aria-label="Staff">
        <h2 class="wa-card__title">Staff ({{ staff.length }})</h2>
        <ul *ngIf="staff.length > 0" class="wa-list">
          <li *ngFor="let s of staff" class="wa-row">
            <div><strong>{{ s.providerDisplayName || s.providerId }}</strong><span class="wa-muted"> · {{ roleText(s.role) }} · {{ statusText(s.status) }} · {{ unitName(s.businessUnitId) }}</span></div>
            <div class="wa-row__actions">
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="assignUnit(s)" [disabled]="!online || !unitId">Assign to unit</button>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="toggle(s)" [disabled]="!online">{{ s.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate' }}</button>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="remove(s)" [disabled]="!online">Remove</button>
            </div>
          </li>
        </ul>
        <p *ngIf="staff.length === 0" class="wa-muted">No staff yet.</p>
        <form (ngSubmit)="add()" class="wa-form" aria-label="Add staff">
          <label class="wa-field"><span>Provider ID</span><input [(ngModel)]="newProviderId" name="providerId" required /></label>
          <label class="wa-field"><span>Role</span><select [(ngModel)]="newRole" name="role"><option value="STAFF">Staff</option><option value="MANAGER">Manager</option></select></label>
          <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Add staff</button>
        </form>
      </section>

      <section *ngIf="!loading && !loadError && businessId" class="wa-card" aria-label="Staff invitations">
        <h2 class="wa-card__title">Invitations</h2>
        <ul *ngIf="invitations.length > 0" class="wa-list">
          <li *ngFor="let inv of invitations" class="wa-row">
            <div><strong>{{ inv.invitedEmail || inv.invitedProviderId }}</strong><span class="wa-muted"> · {{ roleText(inv.role) }} · {{ statusText(inv.status) }} · {{ expiryText(inv.expiresAt) }}</span></div>
            <button *ngIf="inv.status === 'PENDING'" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="revoke(inv)" [disabled]="!online">Revoke</button>
          </li>
        </ul>
        <p *ngIf="lastToken" class="wa-token" role="status">Invitation token (shown once): <code>{{ lastToken }}</code></p>
        <form (ngSubmit)="invite()" class="wa-form" aria-label="Invite staff">
          <label class="wa-field"><span>Provider ID (optional if email given)</span><input [(ngModel)]="invProviderId" name="invProviderId" /></label>
          <label class="wa-field"><span>Email (optional)</span><input [(ngModel)]="invEmail" name="invEmail" type="email" /></label>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Send invitation</button>
        </form>
        <form (ngSubmit)="accept()" class="wa-form" aria-label="Accept invitation">
          <label class="wa-field"><span>Accept with token</span><input [(ngModel)]="acceptToken" name="acceptToken" /></label>
          <button type="submit" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="!online || !acceptToken">Accept invitation</button>
        </form>
      </section>
    </div>
  `,
})
export class BusinessStaffPage implements OnInit {
  private readonly api = inject(BusinessApiService);
  businesses: any[] = [];
  businessId: string | null = null;
  units: any[] = [];
  unitId = '';
  staff: any[] = [];
  invitations: any[] = [];
  loading = true;
  loadError: string | null = null;
  formError: string | null = null;
  newProviderId = '';
  newRole = 'STAFF';
  invProviderId = '';
  invEmail = '';
  lastToken: string | null = null;
  acceptToken = '';

  get online(): boolean {
    return isOnline();
  }
  get offlineText(): string {
    return offlineMessage();
  }

  ngOnInit(): void {
    this.load();
  }

  roleText(r: string): string {
    return roleLabel(r);
  }
  statusText(s: string): string {
    return statusLabel(s);
  }
  expiryText(e: string): string {
    return invitationExpiryLabel(e);
  }
  unitName(id: string | null): string {
    if (!id) return 'No unit';
    return this.units.find((u) => u.id === id)?.name ?? id;
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        if (!canManageBusiness(caps?.data?.tierCode)) {
          this.loading = false;
          this.loadError = 'Staff management needs a T3 Business account.';
          return;
        }
        this.api.listBusinesses().subscribe({
          next: (res) => {
            this.businesses = res?.data ?? [];
            if (!this.businessId && this.businesses.length > 0) this.businessId = this.businesses[0].id;
            this.loading = false;
            if (this.businessId) this.reload();
          },
          error: (e) => {
            this.loading = false;
            this.loadError = mutationErrorMessage(e, 'Could not load businesses.');
          },
        });
      },
      error: (e) => {
        this.loading = false;
        this.loadError = mutationErrorMessage(e, 'Could not load capabilities.');
      },
    });
  }

  reload(): void {
    if (!this.businessId) return;
    this.api.listUnits(this.businessId).subscribe({ next: (res) => (this.units = res?.data ?? []) });
    this.api.listStaff(this.businessId).subscribe({
      next: (res) => (this.staff = res?.data ?? []),
      error: (e) => {
        this.loadError = mutationErrorMessage(e, 'Could not load staff.');
      },
    });
    this.api.listStaffInvitations(this.businessId).subscribe({
      next: (res) => (this.invitations = res?.data ?? []),
    });
  }

  add(): void {
    if (!this.online || !this.businessId) {
      this.formError = offlineMessage();
      return;
    }
    this.formError = null;
    this.api.addStaff(this.businessId, { providerId: this.newProviderId.trim(), role: this.newRole, businessUnitId: this.unitId || null }).subscribe({
      next: () => {
        this.newProviderId = '';
        this.reload();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not add staff.');
      },
    });
  }

  toggle(s: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.updateStaff(s.id, { status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }).subscribe({
      next: () => this.reload(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not update staff.');
      },
    });
  }

  assignUnit(s: any): void {
    if (!this.online || !this.unitId) return;
    this.api.updateStaff(s.id, { businessUnitId: this.unitId }).subscribe({
      next: () => this.reload(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not assign staff.');
      },
    });
  }

  remove(s: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.removeStaff(s.id).subscribe({
      next: () => this.reload(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not remove staff.');
      },
    });
  }

  invite(): void {
    if (!this.online || !this.businessId) {
      this.formError = offlineMessage();
      return;
    }
    this.lastToken = null;
    this.api.createStaffInvitation(this.businessId, {
      invitedProviderId: this.invProviderId.trim() || undefined,
      invitedEmail: this.invEmail.trim() || undefined,
      role: 'STAFF',
      businessUnitId: this.unitId || null,
    }).subscribe({
      next: (res) => {
        this.lastToken = res?.data?.token ?? null;
        this.invProviderId = '';
        this.invEmail = '';
        this.reload();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not create invitation.');
      },
    });
  }

  revoke(inv: any): void {
    if (!this.online || !this.businessId) return;
    this.api.revokeStaffInvitation(this.businessId, inv.id).subscribe({
      next: () => this.reload(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not revoke invitation.');
      },
    });
  }

  accept(): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.acceptStaffInvitation(this.acceptToken.trim()).subscribe({
      next: () => {
        this.acceptToken = '';
        this.reload();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not accept invitation.');
      },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import {
  canManageTeam,
  invitationExpiryLabel,
  mutationErrorMessage,
  offlineMessage,
  roleLabel,
  statusLabel,
  tierLabel,
} from './business.utils';

/**
 * Slice 15 — T2 team members + invitations (web).
 * Members are deactivated, never deleted. Invitation tokens are shown
 * once at creation; only the hash is stored server-side.
 * Booking assignment designates the operational member per booking —
 * it never changes status, payment or completion.
 */
@Component({
  selector: 'waasha-team-members',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-members">
      <header class="wa-members__head">
        <div>
          <h1 class="wa-title">Team members</h1>
          <p class="wa-sub">Tier: <strong>{{ tierText }}</strong> · Removing a member deactivates them; history is preserved.</p>
        </div>
        <a routerLink="/provider/team" class="wa-btn wa-btn-ghost wa-btn--sm">Team</a>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading members…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load members</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Members">
        <h2 class="wa-card__title">Members ({{ members.length }})</h2>
        <ul *ngIf="members.length > 0" class="wa-list">
          <li *ngFor="let m of members" class="wa-row">
            <div><strong>{{ m.providerDisplayName || m.providerId }}</strong><span class="wa-muted"> · {{ roleText(m.role) }} · {{ statusText(m.status) }}</span></div>
            <div class="wa-row__actions">
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="toggleMember(m)" [disabled]="!online">{{ m.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate' }}</button>
              <button *ngIf="m.status === 'ACTIVE'" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="remove(m)" [disabled]="!online">Remove</button>
            </div>
          </li>
        </ul>
        <p *ngIf="members.length === 0" class="wa-muted">No members yet. Add providers directly or send an invitation.</p>
        <form (ngSubmit)="add()" class="wa-form" aria-label="Add member">
          <label class="wa-field"><span>Provider ID</span><input [(ngModel)]="newProviderId" name="providerId" required /></label>
          <label class="wa-field"><span>Role</span><select [(ngModel)]="newRole" name="role"><option value="PROVIDER">Provider</option><option value="MANAGER">Manager</option></select></label>
          <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Add member</button>
        </form>
      </section>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Invitations">
        <h2 class="wa-card__title">Invitations</h2>
        <ul *ngIf="invitations.length > 0" class="wa-list">
          <li *ngFor="let inv of invitations" class="wa-row">
            <div><strong>{{ inv.invitedEmail || inv.invitedProviderId }}</strong><span class="wa-muted"> · {{ roleText(inv.role) }} · {{ statusText(inv.status) }} · {{ expiryText(inv.expiresAt) }}</span></div>
            <button *ngIf="inv.status === 'PENDING'" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="revoke(inv)" [disabled]="!online">Revoke</button>
          </li>
        </ul>
        <p *ngIf="lastToken" class="wa-token" role="status">Invitation token (shown once — share it with the invitee): <code>{{ lastToken }}</code></p>
        <form (ngSubmit)="invite()" class="wa-form" aria-label="Invite member">
          <label class="wa-field"><span>Provider ID (optional if email given)</span><input [(ngModel)]="invProviderId" name="invProviderId" /></label>
          <label class="wa-field"><span>Email (optional)</span><input [(ngModel)]="invEmail" name="invEmail" type="email" /></label>
          <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Send invitation</button>
        </form>
        <form (ngSubmit)="accept()" class="wa-form" aria-label="Accept invitation">
          <label class="wa-field"><span>Accept with token</span><input [(ngModel)]="acceptToken" name="acceptToken" /></label>
          <button type="submit" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="!online || !acceptToken">Accept invitation</button>
        </form>
      </section>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Assign booking">
        <h2 class="wa-card__title">Assign a booking</h2>
        <p class="wa-muted">Assignment names the operational member. Status, payment and completion are untouched.</p>
        <form (ngSubmit)="assign()" class="wa-form">
          <label class="wa-field"><span>Booking ID</span><input [(ngModel)]="assignBookingId" name="bookingId" required /></label>
          <label class="wa-field"><span>Assignee provider ID</span><input [(ngModel)]="assignProviderId" name="assignee" required /></label>
          <p *ngIf="assignMsg" class="wa-muted" role="status">{{ assignMsg }}</p>
          <div class="wa-row__actions">
            <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Assign booking</button>
            <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="unassign()" [disabled]="!online">Unassign</button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class TeamMembersComponent implements OnInit {
  private readonly api = inject(BusinessApiService);
  tier: string | null = null;
  members: any[] = [];
  invitations: any[] = [];
  loading = true;
  loadError: string | null = null;
  formError: string | null = null;
  newProviderId = '';
  newRole = 'PROVIDER';
  invProviderId = '';
  invEmail = '';
  lastToken: string | null = null;
  acceptToken = '';
  assignBookingId = '';
  assignProviderId = '';
  assignMsg: string | null = null;

  get tierText(): string {
    return tierLabel(this.tier);
  }
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

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        this.tier = caps?.data?.tierCode ?? null;
        if (!canManageTeam(this.tier)) {
          this.loading = false;
          this.loadError = 'Team management needs a T2 Teams account.';
          return;
        }
        this.api.listTeamMembers().subscribe({
          next: (res) => {
            this.members = res?.data ?? [];
            this.api.listTeamInvitations().subscribe({
              next: (inv) => {
                this.invitations = inv?.data ?? [];
                this.loading = false;
              },
              error: (e) => {
                this.loading = false;
                this.loadError = mutationErrorMessage(e, 'Could not load invitations.');
              },
            });
          },
          error: (e) => {
            this.loading = false;
            this.loadError = mutationErrorMessage(e, 'Could not load members.');
          },
        });
      },
      error: (e) => {
        this.loading = false;
        this.loadError = mutationErrorMessage(e, 'Could not load capabilities.');
      },
    });
  }

  add(): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.formError = null;
    this.api.addTeamMember({ providerId: this.newProviderId.trim(), role: this.newRole }).subscribe({
      next: () => {
        this.newProviderId = '';
        this.load();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not add member.');
      },
    });
  }

  toggleMember(m: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.updateTeamMember(m.id, { status: m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not update member.');
      },
    });
  }

  remove(m: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.removeTeamMember(m.id).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not remove member.');
      },
    });
  }

  invite(): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.formError = null;
    this.lastToken = null;
    this.api
      .createTeamInvitation({
        invitedProviderId: this.invProviderId.trim() || undefined,
        invitedEmail: this.invEmail.trim() || undefined,
        role: 'PROVIDER',
      })
      .subscribe({
        next: (res) => {
          this.lastToken = res?.data?.token ?? null;
          this.invProviderId = '';
          this.invEmail = '';
          this.load();
        },
        error: (e) => {
          this.formError = mutationErrorMessage(e, 'Could not create invitation.');
        },
      });
  }

  revoke(inv: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.revokeTeamInvitation(inv.id).subscribe({
      next: () => this.load(),
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
    this.api.acceptTeamInvitation(this.acceptToken.trim()).subscribe({
      next: () => {
        this.acceptToken = '';
        this.load();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not accept invitation.');
      },
    });
  }

  assign(): void {
    if (!this.online) {
      this.assignMsg = offlineMessage();
      return;
    }
    this.api.assignBooking(this.assignBookingId.trim(), this.assignProviderId.trim()).subscribe({
      next: () => {
        this.assignMsg = 'Booking assigned. Status, payment and completion are unchanged.';
      },
      error: (e) => {
        this.assignMsg = mutationErrorMessage(e, 'Could not assign booking.');
      },
    });
  }

  unassign(): void {
    if (!this.online) {
      this.assignMsg = offlineMessage();
      return;
    }
    this.api.unassignBooking(this.assignBookingId.trim()).subscribe({
      next: () => {
        this.assignMsg = 'Booking unassigned.';
      },
      error: (e) => {
        this.assignMsg = mutationErrorMessage(e, 'Could not unassign booking.');
      },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import { canManageTeam, mutationErrorMessage, offlineMessage, statusLabel, tierLabel } from './business.utils';

/**
 * Slice 15 — T2 team overview (mobile).
 * Shows the current tier, the owned team (or creation), and links to
 * member management. T1 providers see an explicit capability gate —
 * the server still enforces tier (403) regardless of UI.
 * Mutations require connectivity and are never queued offline.
 */
@Component({
  selector: 'waasha-mobile-team',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-team">
      <header class="wa-team__head">
        <div>
          <h1 class="wa-title">Team management</h1>
          <p class="wa-sub">Tier: <strong>{{ tierText }}</strong> · T2 Teams manage people; T1 stays individual.</p>
        </div>
        <nav class="wa-links" aria-label="Business sections">
          <a routerLink="/provider/team/members" class="wa-btn wa-btn-ghost wa-btn--sm">Members</a>
          <a routerLink="/provider/bookings" class="wa-btn wa-btn-ghost wa-btn--sm">Bookings</a>
        </nav>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading team…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ forbidden ? 'Not available for your tier' : "Couldn't load team" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError && team" class="wa-card" aria-label="Team details">
        <h2 class="wa-card__title">{{ team.name }}</h2>
        <p class="wa-muted">{{ team.description || 'No description yet.' }}</p>
        <dl class="wa-meta">
          <div><dt>Status</dt><dd>{{ statusText(team.status) }}</dd></div>
          <div><dt>Members</dt><dd>{{ team.activeMemberCount }} active / {{ team.memberCount }} total</dd></div>
        </dl>
        <form (ngSubmit)="save()" class="wa-form" aria-label="Rename team">
          <label class="wa-field"><span>Team name</span><input [(ngModel)]="editName" name="name" maxlength="120" required /></label>
          <label class="wa-field"><span>Description</span><textarea [(ngModel)]="editDescription" name="description" rows="2" maxlength="2000"></textarea></label>
          <p *ngIf="saveError" class="wa-field__error" role="alert">{{ saveError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="saving || !online">Save changes</button>
        </form>
      </section>

      <section *ngIf="!loading && !loadError && !team && teamCapable" class="wa-card" aria-label="Create team">
        <h2 class="wa-card__title">Create your team</h2>
        <p class="wa-muted">One team per T2 provider. Members join by invitation or direct add.</p>
        <form (ngSubmit)="create()" class="wa-form">
          <label class="wa-field"><span>Team name</span><input [(ngModel)]="editName" name="name" maxlength="120" required /></label>
          <label class="wa-field"><span>Description</span><textarea [(ngModel)]="editDescription" name="description" rows="2" maxlength="2000"></textarea></label>
          <p *ngIf="saveError" class="wa-field__error" role="alert">{{ saveError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="saving || !online">Create team</button>
        </form>
      </section>
    </div>
  `,
})
export class TeamPage implements OnInit {
  private readonly api = inject(BusinessApiService);
  tier: string | null = null;
  team: any = null;
  loading = true;
  saving = false;
  loadError: string | null = null;
  saveError: string | null = null;
  forbidden = false;
  editName = '';
  editDescription = '';

  get tierText(): string {
    return tierLabel(this.tier);
  }
  get teamCapable(): boolean {
    return canManageTeam(this.tier);
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

  statusText(s: string): string {
    return statusLabel(s);
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.forbidden = false;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        this.tier = caps?.data?.tierCode ?? null;
        if (!canManageTeam(this.tier)) {
          this.loading = false;
          this.forbidden = true;
          this.loadError = 'Team management needs a T2 Teams account. Your tier does not include teams.';
          return;
        }
        this.api.getTeam().subscribe({
          next: (res) => {
            this.team = res?.data ?? null;
            this.editName = this.team?.name ?? '';
            this.editDescription = this.team?.description ?? '';
            this.loading = false;
          },
          error: (e) => {
            const code = e?.error?.error?.code;
            if (code === 'TEAM_NOT_FOUND') {
              this.team = null;
              this.loading = false;
              return;
            }
            this.loading = false;
            this.loadError = mutationErrorMessage(e, 'Could not load the team.');
          },
        });
      },
      error: (e) => {
        this.loading = false;
        this.loadError = mutationErrorMessage(e, 'Could not load capabilities.');
      },
    });
  }

  create(): void {
    if (!this.online) {
      this.saveError = offlineMessage();
      return;
    }
    this.saving = true;
    this.saveError = null;
    this.api.createTeam({ name: this.editName.trim(), description: this.editDescription.trim() || null }).subscribe({
      next: (res) => {
        this.team = res?.data ?? null;
        this.saving = false;
      },
      error: (e) => {
        this.saving = false;
        this.saveError = mutationErrorMessage(e, 'Could not create the team.');
      },
    });
  }

  save(): void {
    if (!this.online) {
      this.saveError = offlineMessage();
      return;
    }
    this.saving = true;
    this.saveError = null;
    this.api.updateTeam({ name: this.editName.trim(), description: this.editDescription.trim() || null }).subscribe({
      next: (res) => {
        this.team = res?.data ?? this.team;
        this.saving = false;
      },
      error: (e) => {
        this.saving = false;
        this.saveError = mutationErrorMessage(e, 'Could not save the team.');
      },
    });
  }
}

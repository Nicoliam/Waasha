import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PartnerApiService } from '../../core/services/partner.service';

/**
 * Slice 17 — partner application + profile (web).
 * New organisations apply here (PENDING until admin approval).
 * Members manage contact/profile fields; status and verification are
 * admin-only and never editable here (server-enforced too).
 */
@Component({
  selector: 'waasha-partner-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Partner · Profile</h1>
      <p class="wa-sub">Partnership applications and organisation profile.</p></header>
      <nav class="wa-adminnav" aria-label="Partner sections">
        <a routerLink="/partner/dashboard">Dashboard</a>
        <a routerLink="/partner/referrals">Referrals</a>
        <a routerLink="/partner/providers">Providers</a>
        <a routerLink="/partner/earnings">Earnings</a>
        <a routerLink="/partner/profile">Profile</a>
      </nav>
      <section *ngIf="loading" class="wa-card" role="status">Loading profile…</section>
      <div *ngIf="error && !loading && hasPartner" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="!loading && hasPartner" class="wa-card" aria-label="Organisation profile">
        <dl class="wa-meta">
          <div><dt>Organisation</dt><dd>{{ partner?.displayName }} ({{ partner?.legalName }})</dd></div>
          <div><dt>Status</dt><dd>{{ partner?.status }} · verification {{ partner?.verificationStatus }}</dd></div>
          <div><dt>Type</dt><dd>{{ partner?.institutionType }}</dd></div>
        </dl>
        <form (ngSubmit)="save()" class="wa-form">
          <label class="wa-field"><span>Display name</span><input [(ngModel)]="form.displayName" name="dn" maxlength="191" /></label>
          <label class="wa-field"><span>Contact email</span><input [(ngModel)]="form.contactEmail" name="ce" maxlength="191" /></label>
          <label class="wa-field"><span>Contact phone</span><input [(ngModel)]="form.contactPhone" name="cp" maxlength="32" /></label>
          <label class="wa-field"><span>Website</span><input [(ngModel)]="form.website" name="ws" maxlength="255" /></label>
          <label class="wa-field"><span>City</span><input [(ngModel)]="form.city" name="city" maxlength="128" /></label>
          <label class="wa-field"><span>Province</span><input [(ngModel)]="form.province" name="prov" maxlength="128" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="saving">Save profile</button>
        </form>
        <p *ngIf="msg" role="status">{{ msg }}</p>
      </section>
      <section *ngIf="!loading && !hasPartner" class="wa-card" aria-label="Apply for partnership">
        <h2 class="wa-card__title">Apply for training-centre partnership</h2>
        <form (ngSubmit)="apply()" class="wa-form">
          <label class="wa-field"><span>Legal name</span><input [(ngModel)]="form.legalName" name="ln" maxlength="191" required /></label>
          <label class="wa-field"><span>Display name</span><input [(ngModel)]="form.displayName" name="dn2" maxlength="191" required /></label>
          <label class="wa-field"><span>Institution type</span><select [(ngModel)]="form.institutionType" name="it">
            <option *ngFor="let t of types" [value]="t">{{ t }}</option></select></label>
          <label class="wa-field"><span>Contact email</span><input [(ngModel)]="form.contactEmail" name="ce2" maxlength="191" /></label>
          <label class="wa-field"><span>Contact phone</span><input [(ngModel)]="form.contactPhone" name="cp2" maxlength="32" /></label>
          <label class="wa-field"><span>City</span><input [(ngModel)]="form.city" name="city2" maxlength="128" /></label>
          <label class="wa-field"><span>Description</span><input [(ngModel)]="form.description" name="desc" maxlength="5000" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="saving">Submit application</button>
        </form>
        <p *ngIf="msg" role="status">{{ msg }}</p>
      </section>
    </div>
  `,
})
export class PartnerProfileComponent implements OnInit {
  private readonly api = inject(PartnerApiService);
  loading = true;
  saving = false;
  error: string | null = null;
  hasPartner = false;
  partner: any = null;
  msg: string | null = null;
  types = ['COLLEGE', 'ACADEMY', 'TRAINING_CENTRE', 'UNIVERSITY', 'NGO', 'OTHER'];
  form: any = { legalName: '', displayName: '', institutionType: 'TRAINING_CENTRE', contactEmail: '', contactPhone: '', website: '', city: '', province: '', description: '' };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.getMine().subscribe({
      next: (res) => {
        this.partner = res.data?.partner ?? null;
        this.hasPartner = Boolean(this.partner);
        if (this.partner) {
          this.form = { ...this.form, ...this.partner };
        }
        this.loading = false;
      },
      error: (err) => {
        if (err?.status === 403) {
          this.hasPartner = false;
          this.loading = false;
          return;
        }
        this.error = err?.error?.error?.message ?? err?.message ?? 'Failed to load profile';
        this.loading = false;
      },
    });
  }

  apply(): void {
    this.saving = true;
    this.msg = null;
    this.api.apply({ ...this.form }).subscribe({
      next: (res) => {
        this.msg = 'Application submitted and pending admin review.';
        this.partner = res.data?.partner ?? null;
        this.hasPartner = Boolean(this.partner);
        this.saving = false;
      },
      error: (err) => {
        this.msg = err?.error?.error?.message ?? err?.message ?? 'Application failed';
        this.saving = false;
      },
    });
  }

  save(): void {
    this.saving = true;
    this.msg = null;
    const { legalName: _drop, ...rest } = this.form;
    void _drop;
    this.api.updateProfile({ displayName: rest.displayName, contactEmail: rest.contactEmail || null, contactPhone: rest.contactPhone || null, website: rest.website || null, city: rest.city || null, province: rest.province || null }).subscribe({
      next: (res) => {
        this.partner = res.data?.partner ?? this.partner;
        this.msg = 'Profile updated.';
        this.saving = false;
      },
      error: (err) => {
        this.msg = err?.error?.error?.message ?? err?.message ?? 'Update failed';
        this.saving = false;
      },
    });
  }
}

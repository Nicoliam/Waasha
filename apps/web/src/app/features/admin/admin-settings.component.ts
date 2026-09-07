import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, shortDate } from './admin.utils';

/**
 * Slice 16 — platform settings (web).
 * Commission rates, cash liability caps and marketplace radii from the
 * allowlisted configuration. Changes are validated server-side, audited
 * with before/after values, and guarded against concurrent edits
 * (optimistic version check). Historical transactions are never rewritten.
 */
@Component({
  selector: 'waasha-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Settings</h1>
      <p class="wa-sub">Configurable platform values. Architectural constants (image limits, 20 km maximum) cannot be changed here.</p></header>
      <waasha-admin-nav />
      <section *ngIf="loading" class="wa-card" role="status">Loading settings…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="!loading" class="wa-card" aria-label="Settings">
        <table *ngIf="settings.length > 0" class="wa-table">
          <thead><tr><th>Setting</th><th>Value</th><th>Updated</th><th></th></tr></thead>
          <tbody><tr *ngFor="let s of settings">
            <td><strong>{{ s.key }}</strong><br /><span class="wa-muted">{{ s.description }}</span></td>
            <td>
              <span *ngIf="!s.configurable" class="wa-muted">{{ s.value }} (fixed)</span>
              <input *ngIf="s.configurable" [(ngModel)]="edits[s.key]" [name]="'edit-' + s.key" maxlength="191" />
            </td>
            <td>{{ date(s.updatedAt) }}</td>
            <td><button *ngIf="s.configurable" type="button" class="wa-btn wa-btn--sm"
              [disabled]="saving[s.key]" (click)="save(s)">Save</button></td>
          </tr></tbody>
        </table>
        <p *ngIf="saveError" class="wa-field__error" role="alert">{{ saveError }}</p>
        <p *ngIf="saved" class="wa-muted" role="status">{{ saved }}</p>
      </section>
    </div>
  `,
})
export class AdminSettingsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  settings: any[] = [];
  edits: Record<string, string> = {};
  saving: Record<string, boolean> = {};
  loading = true;
  error: string | null = null;
  saveError: string | null = null;
  saved: string | null = null;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.getSettings().subscribe({
      next: (res) => {
        this.settings = res.data;
        this.edits = {};
        for (const s of this.settings) this.edits[s.key] = s.value ?? '';
        this.loading = false;
      },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  date(v: unknown): string { return shortDate(v); }

  save(s: any): void {
    if (!window.confirm(`Confirm: change ${s.key} to "${this.edits[s.key]}"? Applies to future transactions only.`)) return;
    this.saving[s.key] = true;
    this.saveError = null;
    this.saved = null;
    const raw = this.edits[s.key];
    const value: string | number | number[] = s.kind === 'RADIUS_LIST'
      ? raw
      : /^-?\d+(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : String(raw);
    this.api.updateSetting(s.key, value, s.updatedAt ?? null).subscribe({
      next: (res) => {
        this.saving[s.key] = false;
        s.value = res.data.value;
        s.updatedAt = res.data.updatedAt;
        this.saved = `${s.key} updated (audited).`;
      },
      error: (err) => { this.saving[s.key] = false; this.saveError = adminErrorMessage(err); },
    });
  }
}

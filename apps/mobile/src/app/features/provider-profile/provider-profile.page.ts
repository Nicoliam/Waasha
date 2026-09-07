import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProviderProfileService } from '../../core/services/provider-profile.service';
import { MediaService } from '../../core/services/media.service';
import { isOffline as isMediaOffline, uploadErrorMessage } from '../../core/services/media-upload';
import {
  ProviderProfileForm,
  emptyProfileForm,
  fromProfile,
  validateProfileForm,
  toProfilePayload,
  profileErrorMessage,
  isOffline,
} from './provider-profile.utils';

@Component({
  selector: 'waasha-mobile-provider-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-prof wa-prof--touch">
      <header class="wa-prof__head">
        <div>
          <h1 class="wa-title">Provider profile</h1>
          <p class="wa-sub">Update how customers see you. Verification, tier and coverage are managed elsewhere and shown here read-only.</p>
        </div>
      </header>

      <div *ngIf="offline" class="wa-card wa-offline" role="status">
        You are offline. Profile details may be stale, and changes cannot be saved until you are back online.
      </div>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading profile…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ unauthorized ? 'Access denied' : "Couldn't load profile" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--lg wa-btn--touch" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--lg wa-btn--touch">Log in</a>
        </div>
      </div>

      <form *ngIf="!loading && !loadError" (ngSubmit)="save()" #f="ngForm" novalidate>
        <section class="wa-card wa-prof__img" aria-label="Profile image">
          <div class="wa-prof__imgrow">
            <img *ngIf="form.profileImageUrl.trim()" [src]="form.profileImageUrl.trim()" alt="Profile image preview" class="wa-prof__avatar" />
            <div *ngIf="!form.profileImageUrl.trim()" class="wa-prof__avatar wa-prof__avatar--empty" aria-hidden="true">
              {{ (form.displayName.trim() || '?').charAt(0).toUpperCase() }}
            </div>
            <div>
              <label class="wa-label" for="mProfileImageUrl">Profile image reference</label>
              <input
                id="mProfileImageUrl"
                name="profileImageUrl"
                type="url"
                class="wa-input wa-input--touch"
                [(ngModel)]="form.profileImageUrl"
                placeholder="https://… or /storage/…"
                autocomplete="off"
              />
              <p class="wa-hint">Reference only, or upload a new image below — it goes live only after the server confirms it.</p>
              <div class="wa-upload" aria-label="Profile image upload">
                <label class="wa-label" for="mProfileImageFile">Upload a profile image</label>
                <input
                  id="mProfileImageFile"
                  name="profileImageFile"
                  type="file"
                  class="wa-input wa-input--touch"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  (change)="onImageSelected($event)"
                  [disabled]="uploading || offline"
                />
                <p class="wa-hint">JPEG, PNG, WebP or HEIC up to 10 MB.</p>
                <p *ngIf="uploadPhase" class="wa-hint" role="status">{{ uploadPhase }}</p>
                <p *ngIf="uploadError" class="wa-error__msg" role="alert">
                  {{ uploadError }}
                  <button type="button" class="wa-btn wa-btn-ghost wa-btn--lg wa-btn--touch" (click)="retryUpload()" [disabled]="uploading">Retry</button>
                </p>
                <p *ngIf="uploadDone" class="wa-saved" role="status">Profile image updated.</p>
                <p *ngIf="offline" class="wa-hint" role="note">You are offline — uploading is disabled and nothing has been uploaded.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="wa-card" aria-label="Editable profile fields">
          <label class="wa-label" for="mDisplayName">Display name</label>
          <input id="mDisplayName" name="displayName" type="text" class="wa-input wa-input--touch" [(ngModel)]="form.displayName" maxlength="80" required />

          <label class="wa-label" for="mBio">Bio</label>
          <textarea id="mBio" name="bio" class="wa-input wa-input--touch" rows="4" [(ngModel)]="form.bio" maxlength="2000"></textarea>

          <label class="wa-label" for="mExperience">Experience summary</label>
          <textarea id="mExperience" name="experienceSummary" class="wa-input wa-input--touch" rows="3" [(ngModel)]="form.experienceSummary" maxlength="2000"></textarea>

          <label class="wa-check wa-check--touch">
            <input type="checkbox" name="customRequestsEnabled" [(ngModel)]="form.customRequestsEnabled" />
            Accept custom requests
          </label>
          <p class="wa-hint">When enabled, eligible customers may send you custom requests.</p>
        </section>

        <section class="wa-card wa-readonly" aria-label="Read-only status">
          <h2 class="wa-section">Verification &amp; account (read-only)</h2>
          <dl class="wa-defs">
            <div><dt>Tier</dt><dd>{{ tierLabel }}</dd></div>
            <div><dt>Verification</dt><dd>{{ profile?.verificationStatus || '—' }}</dd></div>
            <div><dt>Account status</dt><dd>{{ profile?.status || '—' }}</dd></div>
            <div><dt>Coverage</dt><dd>{{ coverageLabel }}</dd></div>
          </dl>
          <p class="wa-hint">Coverage is managed under <a routerLink="/provider/availability">availability</a>. Tier and verification are managed by Waasha.</p>
        </section>

        <ul *ngIf="formErrors.length > 0" class="wa-card wa-errorlist" role="alert">
          <li *ngFor="let e of formErrors">{{ e }}</li>
        </ul>

        <p *ngIf="saveError" class="wa-card wa-error__msg" role="alert">{{ saveError }}</p>
        <p *ngIf="saved" class="wa-card wa-saved" role="status">Profile saved.</p>
        <p *ngIf="noChanges" class="wa-hint" role="status">No changes to save.</p>

        <div class="wa-actions wa-actions--touch">
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--lg wa-btn--touch" [disabled]="saving || offline">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--lg wa-btn--touch" (click)="reset()" [disabled]="saving">Cancel</button>
        </div>
        <p *ngIf="offline" class="wa-hint" role="note">You are offline — saving is disabled and the change is not queued.</p>
      </form>
    </div>
  `,
})
export class ProviderProfilePage implements OnInit {
  private readonly api = inject(ProviderProfileService);
  private readonly media = inject(MediaService);

  form: ProviderProfileForm = emptyProfileForm();
  pristine: ProviderProfileForm = emptyProfileForm();
  profile: any = null;
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  offline = isOffline();
  saving = false;
  saved = false;
  saveError: string | null = null;
  noChanges = false;
  formErrors: string[] = [];
  uploading = false;
  uploadPhase: string | null = null;
  uploadError: string | null = null;
  uploadDone = false;
  private pendingFile: File | null = null;

  get tierLabel(): string {
    return this.profile?.tier ? `${this.profile.tier.code} — ${this.profile.tier.name}` : '—';
  }

  get coverageLabel(): string {
    return this.profile?.coverageRadiusKm != null ? `${this.profile.coverageRadiusKm} km` : '—';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.offline = isOffline();
    this.api.getMe().subscribe({
      next: (res) => {
        this.profile = res?.data ?? null;
        this.form = fromProfile(this.profile);
        this.pristine = fromProfile(this.profile);
        this.loading = false;
      },
      error: (e) => {
        this.loading = false;
        const code = e?.error?.error?.code as string | undefined;
        this.unauthorized = code === 'UNAUTHORIZED' || e?.status === 401;
        this.loadError = profileErrorMessage(code, "Couldn't load your profile. Check your connection and retry.");
      },
    });
  }

  reset(): void {
    this.form = { ...this.pristine };
    this.formErrors = [];
    this.saveError = null;
    this.saved = false;
    this.noChanges = false;
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] ?? null;
    this.uploadError = null;
    this.uploadDone = false;
    if (!file) return;
    this.pendingFile = file;
    this.startUpload();
  }

  retryUpload(): void {
    if (this.pendingFile && !this.uploading) this.startUpload();
  }

  private startUpload(): void {
    const file = this.pendingFile;
    if (!file) return;
    if (isMediaOffline()) {
      this.offline = true;
      this.uploadError = uploadErrorMessage('OFFLINE', 'You are offline.');
      return;
    }
    this.uploading = true;
    this.uploadError = null;
    this.uploadDone = false;
    this.uploadPhase = 'Uploading image…';
    this.media.uploadFile(file, 'PROFILE').subscribe({
      next: (outcome) => {
        this.uploadPhase = 'Confirming image…';
        this.media.attachProfile(outcome.mediaId).subscribe({
          next: (res) => {
            this.uploading = false;
            this.uploadPhase = null;
            this.pendingFile = null;
            const viewUrl = (res?.data?.profileImageUrl as string) || (outcome.viewUrl ?? '');
            this.profile = this.profile ?? {};
            this.form = { ...this.form, profileImageUrl: viewUrl };
            this.pristine = { ...this.pristine, profileImageUrl: viewUrl };
            this.uploadDone = true;
          },
          error: (e) => {
            this.uploading = false;
            this.uploadPhase = null;
            this.uploadError = uploadErrorMessage(e?.error?.error?.code, 'Could not set the profile image. Try again.');
          },
        });
      },
      error: (e) => {
        this.uploading = false;
        this.uploadPhase = null;
        const code = (e as any)?.code as string | undefined;
        this.uploadError = uploadErrorMessage(code ?? e?.error?.error?.code, 'Image upload failed. Retry — nothing has been saved.');
      },
    });
  }

  save(): void {
    this.saveError = null;
    this.saved = false;
    this.noChanges = false;
    if (isOffline()) {
      this.offline = true;
      this.saveError = 'You are offline. Reconnect before saving — changes are never applied offline.';
      return;
    }
    this.formErrors = validateProfileForm(this.form);
    if (this.formErrors.length > 0) return;
    const payload = toProfilePayload(this.form, this.pristine);
    if (Object.keys(payload).length === 0) {
      this.noChanges = true;
      return;
    }
    this.saving = true;
    this.api.updateMe(payload).subscribe({
      next: (res) => {
        this.saving = false;
        this.profile = res?.data ?? this.profile;
        this.form = fromProfile(this.profile);
        this.pristine = fromProfile(this.profile);
        this.saved = true;
      },
      error: (e) => {
        this.saving = false;
        this.saveError = profileErrorMessage(e?.error?.error?.code, 'Could not save your profile. Try again.');
      },
    });
  }
}

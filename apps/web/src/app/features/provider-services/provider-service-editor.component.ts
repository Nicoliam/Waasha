import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ProviderServicesService } from '../../core/services/provider-services.service';
import { MediaService } from '../../core/services/media.service';
import { isOffline as isMediaOffline, uploadErrorMessage } from '../../core/services/media-upload';
import {
  ServiceEditorModel,
  emptyEditor,
  validateEditor,
  toPayload,
  fromDetail,
  serviceErrorMessage,
  MAX_SERVICE_IMAGES,
} from './provider-services.utils';

interface CategoryOption {
  id: string;
  code: string;
  name: string;
}

@Component({
  selector: 'waasha-provider-service-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-sedit">
      <a routerLink="/provider/services" class="wa-back">← Back to services</a>
      <h1 class="wa-title">{{ isNew ? 'New service' : 'Edit service' }}</h1>
      <p class="wa-sub">Price and duration changes apply to future bookings only. Existing bookings keep their original values.</p>

      <div *ngIf="offline" class="wa-card wa-offline" role="status">
        You are offline. Saving is deferred until you are back online — nothing has been saved.
      </div>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading service…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load service</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <a routerLink="/provider/services" class="wa-btn wa-btn-ghost wa-btn--sm">Back to services</a>
      </div>

      <form *ngIf="!loading && !loadError" (ngSubmit)="save()" #f="ngForm" class="wa-card wa-form" novalidate>
        <label class="wa-field">
          <span>Service name *</span>
          <input name="name" [(ngModel)]="model.name" maxlength="120" required placeholder="e.g. Classic fade" />
        </label>

        <label class="wa-field">
          <span>Description</span>
          <textarea name="description" [(ngModel)]="model.description" maxlength="2000" rows="4" placeholder="What does this service include?"></textarea>
        </label>

        <label class="wa-field">
          <span>Category *</span>
          <select name="category" [(ngModel)]="model.serviceCategoryId" required>
            <option value="">Choose a category…</option>
            <option *ngFor="let c of categories" [value]="c.id">{{ c.name }}</option>
          </select>
        </label>

        <div class="wa-row">
          <label class="wa-field">
            <span>Price (R) *</span>
            <input name="price" [(ngModel)]="model.price" inputmode="decimal" required placeholder="e.g. 150.00" />
          </label>
          <label class="wa-field">
            <span>Duration (minutes) *</span>
            <input name="duration" [(ngModel)]="model.durationMinutes" inputmode="numeric" required placeholder="e.g. 30" />
          </label>
        </div>

        <label class="wa-field">
          <span>Service mode *</span>
          <select name="mode" [(ngModel)]="model.serviceMode" required>
            <option value="BOTH">Provider or customer location</option>
            <option value="PROVIDER_LOCATION">At provider location</option>
            <option value="CUSTOMER_LOCATION">At customer location</option>
          </select>
        </label>

        <fieldset class="wa-field">
          <legend>Images (up to {{ maxImages }})</legend>
          <div *ngFor="let img of model.images; let i = index; trackBy: trackImage" class="wa-imgrow">
            <input [name]="'image' + i" [(ngModel)]="model.images[i]" placeholder="https://… storage reference" inputmode="url" />
            <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="removeImage(i)">Remove</button>
          </div>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="addImage()" [disabled]="model.images.length >= maxImages">
            Add image
          </button>
          <p class="wa-hint">Paste a backend-confirmed image reference, or upload a new image below — it is used only after the server confirms it (max 3).</p>
          <div class="wa-upload" aria-label="Service image upload">
            <label class="wa-label" for="serviceImageFile">Upload an image</label>
            <input
              id="serviceImageFile"
              type="file"
              class="wa-input"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              (change)="onServiceImageSelected($event)"
              [disabled]="uploadingImage || offline || model.images.length >= maxImages"
            />
            <p *ngIf="imageUploadPhase" class="wa-hint" role="status">{{ imageUploadPhase }}</p>
            <p *ngIf="imageUploadError" class="wa-error__msg" role="alert">
              {{ imageUploadError }}
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="retryImageUpload()" [disabled]="uploadingImage">Retry</button>
            </p>
            <p *ngIf="offline" class="wa-hint" role="note">You are offline — uploading is disabled and nothing has been uploaded.</p>
          </div>
          <div *ngIf="!isNew && persistedImages.length > 0" class="wa-imgpersist" aria-label="Saved images">
            <div *ngFor="let img of persistedImages" class="wa-imgrow">
              <img [src]="img.imageUrl" alt="Saved service image" class="wa-service__img" loading="lazy" />
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm wa-danger" (click)="removePersistedImage(img.id)" [disabled]="removingImageId === img.id">
                {{ removingImageId === img.id ? 'Removing…' : 'Remove saved' }}
              </button>
            </div>
          </div>
        </fieldset>

        <label class="wa-check">
          <input type="checkbox" name="isActive" [(ngModel)]="model.isActive" />
          <span>Active — visible in the marketplace and bookable</span>
        </label>

        <div *ngIf="validationErrors.length > 0" class="wa-card wa-error" role="alert">
          <ul>
            <li *ngFor="let e of validationErrors">{{ e }}</li>
          </ul>
        </div>

        <div *ngIf="saveError" class="wa-card wa-error" role="alert">
          <p class="wa-error__title">{{ conflict ? 'Changed elsewhere' : 'Could not save' }}</p>
          <p class="wa-error__msg">{{ saveError }}</p>
          <button *ngIf="conflict" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="reload()">Reload latest</button>
        </div>

        <div *ngIf="saved" class="wa-card wa-saved" role="status">Saved.</div>

        <div class="wa-form__actions">
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy" [disabled]="saving">
            {{ saving ? 'Saving…' : 'Save service' }}
          </button>
          <a routerLink="/provider/services" class="wa-btn wa-btn-ghost">Cancel</a>
        </div>
      </form>
    </div>
  `,
})
export class ProviderServiceEditorComponent implements OnInit {
  private readonly api = inject(ProviderServicesService);
  private readonly media = inject(MediaService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  model: ServiceEditorModel = emptyEditor();
  categories: CategoryOption[] = [];
  isNew = true;
  serviceId: string | null = null;
  loading = false;
  loadError: string | null = null;
  validationErrors: string[] = [];
  saving = false;
  saved = false;
  saveError: string | null = null;
  conflict = false;
  unauthorized = false;
  offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  maxImages = MAX_SERVICE_IMAGES;
  uploadingImage = false;
  imageUploadPhase: string | null = null;
  imageUploadError: string | null = null;
  removingImageId: string | null = null;
  persistedImages: Array<{ id: string; imageUrl: string }> = [];
  private pendingImageFile: File | null = null;

  ngOnInit(): void {
    this.loadCategories();
    const id = this.route.snapshot.paramMap.get('serviceId');
    if (!id || id === 'new') {
      this.isNew = true;
      return;
    }
    this.isNew = false;
    this.serviceId = id;
    this.loadDetail(id);
  }

  trackImage(index: number): number {
    return index;
  }

  addImage(): void {
    if (this.model.images.length < MAX_SERVICE_IMAGES) this.model.images.push('');
  }

  removeImage(index: number): void {
    this.model.images.splice(index, 1);
  }

  loadCategories(): void {
    this.http.get<{ success: boolean; data: CategoryOption[] }>('/api/v1/marketplace/categories').subscribe({
      next: (res) => {
        this.categories = Array.isArray(res.data) ? res.data : [];
      },
      error: () => {
        this.categories = [];
      },
    });
  }

  loadDetail(id: string): void {
    this.loading = true;
    this.loadError = null;
    this.api.getDetail(id).subscribe({
      next: (res) => {
        this.loading = false;
        this.model = fromDetail(res.data);
        this.persistedImages = Array.isArray(res.data?.images)
          ? res.data.images.filter((i: any) => i && i.id && i.imageUrl).map((i: any) => ({ id: String(i.id), imageUrl: String(i.imageUrl) }))
          : [];
      },
      error: (e) => {
        this.loading = false;
        const code = e?.error?.error?.code as string | undefined;
        this.unauthorized = code === 'UNAUTHORIZED' || e?.status === 401;
        this.loadError = serviceErrorMessage(code, "Couldn't load the service.");
      },
    });
  }

  onServiceImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] ?? null;
    this.imageUploadError = null;
    if (!file) return;
    this.pendingImageFile = file;
    this.startImageUpload();
  }

  retryImageUpload(): void {
    if (this.pendingImageFile && !this.uploadingImage) this.startImageUpload();
  }

  private startImageUpload(): void {
    const file = this.pendingImageFile;
    if (!file) return;
    if (isMediaOffline()) {
      this.offline = true;
      this.imageUploadError = uploadErrorMessage('OFFLINE', 'You are offline.');
      return;
    }
    if (this.model.images.length >= MAX_SERVICE_IMAGES) {
      this.imageUploadError = uploadErrorMessage('SERVICE_IMAGE_LIMIT', 'A service may have at most 3 images.');
      return;
    }
    this.uploadingImage = true;
    this.imageUploadError = null;
    this.imageUploadPhase = 'Uploading image…';
    this.media.uploadFile(file, 'SERVICE', this.isNew ? null : this.serviceId).subscribe({
      next: (outcome) => {
        if (this.isNew || !this.serviceId) {
          // New service: keep the backend-finalized reference locally until save.
          this.uploadingImage = false;
          this.imageUploadPhase = null;
          this.pendingImageFile = null;
          if (outcome.viewUrl) this.model.images.push(outcome.viewUrl);
          return;
        }
        this.imageUploadPhase = 'Attaching image…';
        this.media.attachService(outcome.mediaId, this.serviceId).subscribe({
          next: () => {
            this.uploadingImage = false;
            this.imageUploadPhase = null;
            this.pendingImageFile = null;
            this.loadDetail(this.serviceId as string);
          },
          error: (e) => {
            this.uploadingImage = false;
            this.imageUploadPhase = null;
            this.imageUploadError = uploadErrorMessage(e?.error?.error?.code, 'Could not attach the image. Try again.');
          },
        });
      },
      error: (e) => {
        this.uploadingImage = false;
        this.imageUploadPhase = null;
        const code = (e as any)?.code as string | undefined;
        this.imageUploadError = uploadErrorMessage(code ?? e?.error?.error?.code, 'Image upload failed. Retry — nothing has been saved.');
      },
    });
  }

  removePersistedImage(imageId: string): void {
    if (!this.serviceId || this.removingImageId) return;
    if (isMediaOffline()) {
      this.saveError = 'You are offline. Reconnect before removing images — nothing has been removed.';
      return;
    }
    this.removingImageId = imageId;
    this.media.removeServiceImage(this.serviceId, imageId).subscribe({
      next: () => {
        this.removingImageId = null;
        this.loadDetail(this.serviceId as string);
      },
      error: (e) => {
        this.removingImageId = null;
        const code = e?.error?.error?.code as string | undefined;
        this.saveError = serviceErrorMessage(code, 'Could not remove the image. Try again.');
      },
    });
  }

  reload(): void {
    if (this.serviceId) {
      this.saveError = null;
      this.conflict = false;
      this.loadDetail(this.serviceId);
    }
  }

  save(): void {
    this.validationErrors = validateEditor(this.model);
    this.saveError = null;
    this.saved = false;
    this.conflict = false;
    if (this.validationErrors.length > 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.saveError = 'You are offline. Reconnect before saving — nothing has been saved.';
      return;
    }
    this.saving = true;
    const payload = toPayload(this.model);
    const done = (data: unknown) => {
      this.saving = false;
      this.saved = true;
      const id = (data as any)?.id as string | undefined;
      if (this.isNew && id) {
        void this.router.navigate(['/provider/services', id]);
      } else if (!this.isNew && (data as any)?.updatedAt) {
        this.model.expectedUpdatedAt = (data as any).updatedAt;
      }
    };
    const fail = (e: any) => {
      this.saving = false;
      const code = e?.error?.error?.code as string | undefined;
      this.conflict = code === 'SERVICE_CONFLICT' || e?.status === 409;
      this.saveError = serviceErrorMessage(code, 'Could not save the service. Try again.');
    };
    if (this.isNew) {
      this.api.create(payload as any).subscribe({ next: (r) => done(r.data), error: fail });
    } else if (this.serviceId) {
      this.api.update(this.serviceId, payload).subscribe({ next: (r) => done(r.data), error: fail });
    }
  }
}

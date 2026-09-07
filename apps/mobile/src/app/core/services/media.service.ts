import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import {
  MediaUploadPurpose,
  isOffline,
  validateFileForUpload,
  UploadFileMeta,
} from './media-upload';

export interface UploadSessionRequest {
  purpose: MediaUploadPurpose;
  targetId?: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksum?: string | null;
}

export interface FinalizedMedia {
  mediaId: string;
  viewUrl: string | null;
  status: string;
  purpose: string;
}

export interface UploadOutcome {
  mediaId: string;
  viewUrl: string | null;
  status: string;
}

export class MediaUploadError extends Error {
  code: string;
  errors?: string[];
  constructor(code: string, message: string, errors?: string[]) {
    super(message);
    this.code = code;
    this.errors = errors;
  }
}

/**
 * Slice 11 — Media API client.
 * Uses constructor injection so the service is unit-testable without TestBed.
 * Identity always comes from the authenticated session; no providerId,
 * userId or tenantId is ever sent as ownership. A file is only treated as
 * uploaded after the backend finalizes it — never after session creation
 * or after the byte PUT alone.
 */
@Injectable({ providedIn: 'root' })
export class MediaService {
  constructor(private readonly http: HttpClient) {}

  createUploadSession(body: UploadSessionRequest): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>('/api/v1/media/upload-sessions', body);
  }

  finalizeUpload(mediaId: string, body: Record<string, unknown> = {}): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/finalize`,
      body,
    );
  }

  getMedia(mediaId: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/media/${encodeURIComponent(mediaId)}`);
  }

  deleteMedia(mediaId: string): Observable<{ success: boolean; data: any }> {
    return this.http.delete<{ success: boolean; data: any }>(`/api/v1/media/${encodeURIComponent(mediaId)}`);
  }

  attachProfile(mediaId: string): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/attach-profile`,
      {},
    );
  }

  attachService(mediaId: string, serviceId: string, sortOrder?: number): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/attach-service`,
      { serviceId, ...(sortOrder !== undefined ? { sortOrder } : {}) },
    );
  }

  removeServiceImage(serviceId: string, imageId: string): Observable<{ success: boolean; data: any }> {
    return this.http.delete<{ success: boolean; data: any }>(
      `/api/v1/providers/me/services/${encodeURIComponent(serviceId)}/images/${encodeURIComponent(imageId)}`,
    );
  }

  /**
   * Full upload lifecycle as one Observable:
   * offline gate → client validation → session → byte PUT → finalize.
   * Emits only after backend finalization. Any failure before finalize
   * leaves the session PENDING server-side (orphan cleanup deferred) and
   * surfaces a coded error — never a fake success.
   */
  uploadFile(file: File, purpose: MediaUploadPurpose, targetId?: string | null): Observable<UploadOutcome> {
    return from(this.runUpload(file, purpose, targetId ?? null));
  }

  private async runUpload(file: File, purpose: MediaUploadPurpose, targetId: string | null): Promise<UploadOutcome> {
    if (isOffline()) {
      throw new MediaUploadError('OFFLINE', 'You are offline. Reconnect before uploading — nothing has been uploaded.');
    }
    const meta: UploadFileMeta = { name: file.name, type: file.type, size: file.size };
    const clientErrors = validateFileForUpload(meta, purpose);
    if (clientErrors.length > 0) {
      const tooLarge = clientErrors.some((e) => e.includes('too large'));
      const unsupported = clientErrors.some((e) => e.includes('Unsupported'));
      throw new MediaUploadError(
        tooLarge ? 'FILE_TOO_LARGE' : unsupported ? 'UNSUPPORTED_FILE' : 'VALIDATION_ERROR',
        clientErrors[0],
        clientErrors,
      );
    }
    let session: any;
    try {
      const res = await firstValueFrom(
        this.createUploadSession({
          purpose,
          targetId,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      );
      session = (res as any)?.data ?? null;
    } catch (e: any) {
      throw new MediaUploadError(
        (e?.error?.error?.code as string) || 'UPLOAD_FAILED',
        'Could not start the upload. Retry — nothing has been saved.',
      );
    }
    const uploadUrl = session?.upload?.uploadUrl as string | undefined;
    const mediaId = session?.mediaId as string | undefined;
    if (!uploadUrl || !mediaId) {
      throw new MediaUploadError('UPLOAD_FAILED', 'Could not start the upload. Retry — nothing has been saved.');
    }
    let putOk = false;
    try {
      const put = await fetch(uploadUrl, { method: 'PUT', body: file as any, headers: { 'Content-Type': file.type } });
      putOk = put.ok;
    } catch {
      putOk = false;
    }
    if (!putOk) {
      // Bytes never landed — do NOT finalize, do NOT claim success.
      throw new MediaUploadError('UPLOAD_FAILED', 'Upload failed before reaching the server. Retry — nothing has been saved.');
    }
    try {
      const fin = await firstValueFrom(
        this.finalizeUpload(mediaId, { sizeBytes: file.size, detectedMimeType: file.type }),
      );
      const data = (fin as any)?.data ?? {};
      if (data?.status !== 'ACTIVE' || !data?.viewUrl) {
        throw new MediaUploadError('FINALIZE_FAILED', 'The upload could not be confirmed. Retry — the image is not live.');
      }
      return { mediaId, viewUrl: data.viewUrl as string, status: data.status as string };
    } catch (e: any) {
      if (e instanceof MediaUploadError) throw e;
      throw new MediaUploadError(
        (e?.error?.error?.code as string) || 'FINALIZE_FAILED',
        'The upload could not be confirmed. Retry — the image is not live.',
      );
    }
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PosApiService } from '../../core/services/pos.service';
import { SyncService } from '../../core/sync/sync.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { ProviderServicesService } from '../../core/services/provider-services.service';
import {
  SaleBuilderLine,
  estimateLineTotal,
  estimateSaleTotal,
  priceLabel,
  validateSale,
  requireOnline,
  saleErrorMessage,
  statusLabel,
  POS_PAYMENT_METHODS,
} from './pos.utils';

type Tab = 'new' | 'history';

/**
 * Slice 14 — Provider POS (web).
 * Quick, touch-friendly sale creation over the same /api/v1/pos API as
 * mobile. Totals shown while building are estimates; the server recomputes
 * every price and total. Slice 18: sale creation queues offline as a REQUEST
 * (idempotent replay, server-validated stock) — never claimed as recorded
 * until the server confirms. Reversals and inventory adjustments stay online-only.
 * A POS sale is never a booking — it records a provider-reported receipt.
 */
@Component({
  selector: 'waasha-mobile-provider-pos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-pos">
      <header class="wa-pos__head">
        <div>
          <h1 class="wa-title">Point of sale</h1>
          <p class="wa-sub">Record walk-in sales. Totals and stock are confirmed by the server — a sale is not a booking.</p>
        </div>
        <nav class="wa-tabs" aria-label="POS views">
          <button type="button" [class.active]="tab === 'new'" (click)="tab = 'new'">New sale</button>
          <button type="button" [class.active]="tab === 'history'" (click)="tab = 'history'; loadHistory()">History</button>
        </nav>
      </header>

      <div *ngIf="offline" class="wa-card wa-offline" role="status">
        You are offline. New sales are saved on this device and will sync when you reconnect — they are NOT recorded yet.
      </div>

      <section *ngIf="tab === 'new'" class="wa-card" aria-label="New sale">
        <h2 class="wa-card__title">New sale</h2>
        <div class="wa-grid">
          <label class="wa-field">
            <span>Add service</span>
            <select [(ngModel)]="servicePick" aria-label="Add service">
              <option value="">Select service…</option>
              <option *ngFor="let s of services" [value]="s.id">{{ s.name }} — {{ money(s.price) }}</option>
            </select>
          </label>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="addService()" [disabled]="!servicePick">Add</button>
          <label class="wa-field">
            <span>Add product</span>
            <select [(ngModel)]="productPick" aria-label="Add product">
              <option value="">Select product…</option>
              <option *ngFor="let p of products" [value]="p.id" [disabled]="!p.isActive || p.quantityOnHand <= 0">
                {{ p.name }} — {{ money(p.sellingPrice) }} ({{ p.quantityOnHand }} in stock)
              </option>
            </select>
          </label>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="addProduct()" [disabled]="!productPick">Add</button>
        </div>

        <ul *ngIf="lines.length > 0" class="wa-lines">
          <li *ngFor="let l of lines; let i = index" class="wa-line">
            <div class="wa-line__main">
              <strong>{{ l.name }}</strong>
              <span class="wa-line__kind">{{ l.lineType === 'SERVICE' ? 'Service' : 'Product' }}</span>
            </div>
            <div class="wa-line__ctrl">
              <button type="button" (click)="decQty(i)" aria-label="Decrease quantity">−</button>
              <span aria-live="polite">{{ l.quantity }}</span>
              <button type="button" (click)="incQty(i)" aria-label="Increase quantity">+</button>
              <span class="wa-line__total">{{ money(lineTotal(l)) }}</span>
              <button type="button" class="wa-link" (click)="removeLine(i)">Remove</button>
            </div>
          </li>
        </ul>
        <p *ngIf="lines.length === 0" class="wa-empty">No lines yet — add a service or product above.</p>

        <div class="wa-payrow" role="radiogroup" aria-label="Payment method">
          <button
            *ngFor="let m of methods"
            type="button"
            class="wa-pay"
            [class.active]="paymentMethod === m.value"
            (click)="paymentMethod = m.value"
            [title]="m.hint"
          >
            {{ m.label }}
          </button>
        </div>

        <div class="wa-totalrow">
          <span>Estimated total (confirmed by server)</span>
          <strong>{{ money(estimateTotal()) }}</strong>
        </div>

        <div *ngIf="formError" class="wa-card wa-error" role="alert">{{ formError }}</div>
        <div *ngIf="queuedSale" class="wa-card wa-offline" role="status">
          Saved locally (ref {{ queuedSale.ref }}) — waiting for connection. This sale is NOT recorded yet and stock is not deducted until the server confirms.
        </div>
        <div *ngIf="saleDone" class="wa-card wa-ok" role="status">
          Sale recorded: {{ saleDone.reference }} — {{ money(saleDone.totalAmount) }} ({{ saleDone.paymentMethod }}).
          <a [routerLink]="['/provider/pos/sales', saleDone.id]">View receipt</a>
        </div>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy" (click)="submit()" [disabled]="submitting || lines.length === 0">
          {{ submitting ? 'Recording…' : 'Record sale' }}
        </button>
      </section>

      <section *ngIf="tab === 'history'" aria-label="Sales history">
        <div *ngIf="historyLoading" class="wa-card" role="status">Loading sales…</div>
        <div *ngIf="historyError" class="wa-card wa-error" role="alert">{{ historyError }}</div>
        <article *ngFor="let s of history" class="wa-card wa-sale">
          <div class="wa-sale__main">
            <a [routerLink]="['/provider/pos/sales', s.id]"><strong>{{ s.reference }}</strong></a>
            <span>{{ money(s.totalAmount) }} · {{ s.paymentMethod }} · {{ s.paymentStatus }}</span>
            <span class="wa-badge" [class.reversed]="s.status === 'REVERSED'">{{ saleStatus(s.status) }}</span>
          </div>
          <span class="wa-sale__date">{{ s.createdAt }}</span>
        </article>
        <p *ngIf="!historyLoading && history.length === 0" class="wa-empty">No sales recorded yet.</p>
      </section>

      <section *ngIf="detail" class="wa-card" aria-label="Sale detail">
        <h2 class="wa-card__title">Receipt {{ detail.reference }}</h2>
        <p>{{ money(detail.totalAmount) }} · {{ detail.paymentMethod }} · {{ detail.paymentStatus }} · {{ saleStatus(detail.status) }}</p>
        <ul class="wa-lines">
          <li *ngFor="let l of detail.lines" class="wa-line">
            <span>{{ l.nameSnapshot }} × {{ l.quantity }}</span>
            <span>{{ money(l.lineTotal) }}</span>
          </li>
        </ul>
        <p *ngIf="detail.commissionAmount != null" class="wa-sub">
          Commission quote (informational only, not settled): {{ money(detail.commissionAmount) }}
        </p>
        <div *ngIf="detail.status === 'COMPLETED'">
          <label class="wa-field"><span>Reversal reason</span><input [(ngModel)]="reverseReason" maxlength="2000" /></label>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="reverse()" [disabled]="reversing">
            {{ reversing ? 'Reversing…' : 'Reverse sale (restores stock)' }}
          </button>
        </div>
        <div *ngIf="detailError" class="wa-card wa-error" role="alert">{{ detailError }}</div>
      </section>
    </div>
  `,
})
export class ProviderPosPage implements OnInit {
  private readonly pos = inject(PosApiService);
  private readonly inventory = inject(InventoryApiService);
  private readonly servicesApi = inject(ProviderServicesService);
  private readonly route = inject(ActivatedRoute);
  private readonly sync = inject(SyncService);

  tab: Tab = 'new';
  offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  services: Array<{ id: string; name: string; price: number }> = [];
  products: Array<{ id: string; name: string; sellingPrice: number; quantityOnHand: number; isActive: boolean }> = [];
  lines: SaleBuilderLine[] = [];
  servicePick = '';
  productPick = '';
  paymentMethod: 'cash' | 'eft' | 'waasha_payment' = 'cash';
  methods = POS_PAYMENT_METHODS;
  submitting = false;
  formError: string | null = null;
  saleDone: any = null;
  /** Slice 18 — offline queue receipt (NOT a recorded sale). */
  queuedSale: { ref: string } | null = null;

  history: any[] = [];
  historyLoading = false;
  historyError: string | null = null;

  detail: any = null;
  detailError: string | null = null;
  reverseReason = '';
  reversing = false;

  ngOnInit(): void {
    this.servicesApi.list({ status: 'ACTIVE', perPage: 50 }).subscribe({
      next: (r: any) => {
        this.services = (r?.data ?? []).map((s: any) => ({ id: s.id, name: s.name, price: Number(s.price) }));
      },
      error: () => {},
    });
    this.inventory.listItems({ perPage: 50, isActive: true }).subscribe({
      next: (r: any) => {
        this.products = (r?.data ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          sellingPrice: Number(p.sellingPrice),
          quantityOnHand: Number(p.quantityOnHand),
          isActive: Boolean(p.isActive),
        }));
      },
      error: () => {},
    });
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadDetail(id);
  }

  money(n: number): string {
    return priceLabel(Number(n) || 0);
  }

  lineTotal(l: SaleBuilderLine): number {
    return estimateLineTotal(l);
  }

  estimateTotal(): number {
    return estimateSaleTotal(this.lines);
  }

  saleStatus(s: string): string {
    return statusLabel(s);
  }

  addService(): void {
    const s = this.services.find((x) => x.id === this.servicePick);
    if (!s) return;
    this.lines.push({ lineType: 'SERVICE', refId: s.id, name: s.name, estimateUnitPrice: s.price, quantity: 1 });
    this.servicePick = '';
  }

  addProduct(): void {
    const p = this.products.find((x) => x.id === this.productPick);
    if (!p) return;
    this.lines.push({
      lineType: 'PRODUCT',
      refId: p.id,
      name: p.name,
      estimateUnitPrice: p.sellingPrice,
      quantity: 1,
      available: p.quantityOnHand,
    });
    this.productPick = '';
  }

  incQty(i: number): void {
    this.lines[i].quantity = Math.min(1000, this.lines[i].quantity + 1);
  }

  decQty(i: number): void {
    this.lines[i].quantity = Math.max(1, this.lines[i].quantity - 1);
  }

  removeLine(i: number): void {
    this.lines.splice(i, 1);
  }

  submit(): void {
    this.formError = null;
    this.saleDone = null;
    this.queuedSale = null;
    const invalid = validateSale(this.lines, this.paymentMethod);
    if (invalid) {
      this.formError = invalid;
      return;
    }
    const saleInput = {
      paymentMethod: this.paymentMethod,
      lines: this.lines.map((l) => ({
        lineType: l.lineType,
        serviceId: l.lineType === 'SERVICE' ? l.refId : undefined,
        inventoryItemId: l.lineType === 'PRODUCT' ? l.refId : undefined,
        quantity: l.quantity,
      })),
    };
    // Slice 18 — offline: queue the sale REQUEST (idempotent replay). The
    // sale is NOT recorded until the server confirms; stock is revalidated
    // server-side and shortages surface as conflicts, never negative stock.
    if (!this.sync.onlineNow) {
      this.submitting = true;
      this.sync
        .enqueueAs('pos.sale.create', saleInput)
        .then((op) => {
          this.submitting = false;
          this.queuedSale = { ref: op.id.slice(0, 8) };
          this.lines = [];
        })
        .catch((e: unknown) => {
          this.submitting = false;
          this.formError = e instanceof Error ? e.message : 'Could not save the sale locally.';
        });
      return;
    }
    const gate = requireOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (!gate.ok) {
      this.formError = gate.message;
      return;
    }
    this.submitting = true;
    this.pos
      .createSale(saleInput)
      .subscribe({
        next: (r: any) => {
          this.submitting = false;
          this.saleDone = r?.data ?? null;
          this.lines = [];
        },
        error: (e: any) => {
          this.submitting = false;
          this.formError = saleErrorMessage(e);
        },
      });
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.historyError = null;
    this.pos.listSales({ perPage: 20 }).subscribe({
      next: (r: any) => {
        this.historyLoading = false;
        this.history = r?.data ?? [];
      },
      error: (e: any) => {
        this.historyLoading = false;
        this.historyError = saleErrorMessage(e);
      },
    });
  }

  loadDetail(id: string): void {
    this.detailError = null;
    this.pos.getSale(id).subscribe({
      next: (r: any) => {
        this.detail = r?.data ?? null;
      },
      error: (e: any) => {
        this.detailError = saleErrorMessage(e);
      },
    });
  }

  reverse(): void {
    if (!this.detail) return;
    const gate = requireOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (!gate.ok) {
      this.detailError = gate.message;
      return;
    }
    this.reversing = true;
    this.pos.reverseSale(this.detail.id, this.reverseReason || null).subscribe({
      next: (r: any) => {
        this.reversing = false;
        this.detail = r?.data ?? null;
        this.reverseReason = '';
      },
      error: (e: any) => {
        this.reversing = false;
        this.detailError = saleErrorMessage(e);
      },
    });
  }
}

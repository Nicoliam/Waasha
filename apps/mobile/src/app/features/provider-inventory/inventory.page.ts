import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryApiService } from '../../core/services/inventory.service';
import {
  stockStatus,
  stockLabel,
  validateItemInput,
  validateStockDelta,
  requireOnline,
  movementLabel,
  inventoryErrorMessage,
} from './inventory.utils';

/**
 * Slice 14 — Provider inventory (web).
 * Item catalogue, stock receive/adjust, movement history over the same
 * /api/v1/pos API as mobile. Balances shown are read-only; the server is
 * authoritative. Mutations are blocked offline (never queued).
 */
@Component({
  selector: 'waasha-mobile-provider-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-inv">
      <header class="wa-inv__head">
        <div>
          <h1 class="wa-title">Inventory</h1>
          <p class="wa-sub">Track products and stock. Every change is recorded with its resulting balance.</p>
        </div>
        <label class="wa-check"><input type="checkbox" [(ngModel)]="lowOnly" (change)="load()" /> Low stock only</label>
      </header>

      <div *ngIf="offline" class="wa-card wa-offline" role="status">
        You are offline. Stock changes cannot be recorded right now — nothing will be queued or faked.
      </div>

      <section class="wa-card" aria-label="Add item">
        <h2 class="wa-card__title">New item</h2>
        <div class="wa-grid">
          <label class="wa-field"><span>Name</span><input [(ngModel)]="form.name" maxlength="120" /></label>
          <label class="wa-field"><span>SKU (optional)</span><input [(ngModel)]="form.sku" maxlength="64" /></label>
          <label class="wa-field"><span>Selling price (R)</span><input type="number" min="0" step="0.01" [(ngModel)]="form.sellingPrice" /></label>
          <label class="wa-field"><span>Cost price (R)</span><input type="number" min="0" step="0.01" [(ngModel)]="form.costPrice" /></label>
          <label class="wa-field"><span>Opening qty</span><input type="number" min="0" step="1" [(ngModel)]="form.quantityOnHand" /></label>
          <label class="wa-field"><span>Low-stock at</span><input type="number" min="0" step="1" [(ngModel)]="form.lowStockThreshold" /></label>
        </div>
        <div *ngIf="formError" class="wa-card wa-error" role="alert">{{ formError }}</div>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="create()" [disabled]="creating">
          {{ creating ? 'Saving…' : 'Add item' }}
        </button>
      </section>

      <div *ngIf="loading" class="wa-card" role="status">Loading inventory…</div>
      <div *ngIf="loadError" class="wa-card wa-error" role="alert">{{ loadError }}</div>

      <article *ngFor="let item of items" class="wa-card wa-item">
        <div class="wa-item__main">
          <a [routerLink]="['/provider/inventory', item.id]"><strong>{{ item.name }}</strong></a>
          <span class="wa-badge" [class.low]="item.isLowStock" [class.out]="item.quantityOnHand <= 0">{{ stockText(item) }}</span>
          <span *ngIf="!item.isActive" class="wa-badge">Inactive</span>
        </div>
        <div class="wa-item__meta">R{{ item.sellingPrice.toFixed(2) }} · {{ item.quantityOnHand }} on hand · SKU {{ item.sku || '—' }}</div>
        <div class="wa-item__actions">
          <input type="number" step="1" [(ngModel)]="stockQty[item.id]" placeholder="Qty" aria-label="Stock quantity" />
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="receive(item)">Receive</button>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="adjust(item, 1)">+ Adjust</button>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="adjust(item, -1)">− Adjust</button>
          <button *ngIf="item.isActive" type="button" class="wa-link" (click)="toggle(item, false)">Deactivate</button>
          <button *ngIf="!item.isActive" type="button" class="wa-link" (click)="toggle(item, true)">Activate</button>
        </div>
        <div *ngIf="rowError[item.id]" class="wa-card wa-error" role="alert">{{ rowError[item.id] }}</div>
      </article>
      <p *ngIf="!loading && items.length === 0" class="wa-empty">No items yet — add your first product above.</p>

      <section *ngIf="detail" class="wa-card" aria-label="Item detail">
        <h2 class="wa-card__title">{{ detail.name }}</h2>
        <p>R{{ detail.sellingPrice.toFixed(2) }} · {{ detail.quantityOnHand }} on hand · {{ stockText(detail) }}</p>
        <h3 class="wa-card__sub">Movement history</h3>
        <ul class="wa-lines">
          <li *ngFor="let m of movements" class="wa-line">
            <span>{{ movementText(m.movementType) }} {{ m.quantityDelta > 0 ? '+' : '' }}{{ m.quantityDelta }} → {{ m.resultingQuantity }}</span>
            <span>{{ m.createdAt }}</span>
          </li>
        </ul>
        <p *ngIf="movements.length === 0" class="wa-empty">No movements recorded.</p>
      </section>
    </div>
  `,
})
export class ProviderInventoryPage implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly route = inject(ActivatedRoute);

  offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  items: any[] = [];
  loading = false;
  loadError: string | null = null;
  lowOnly = false;
  creating = false;
  form = { name: '', sku: '', sellingPrice: 0, costPrice: 0, quantityOnHand: 0, lowStockThreshold: 0 };
  formError: string | null = null;
  stockQty: Record<string, number> = {};
  rowError: Record<string, string> = {};
  detail: any = null;
  movements: any[] = [];

  ngOnInit(): void {
    this.load();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadDetail(id);
  }

  stockText(item: any): string {
    return stockLabel(stockStatus({ quantityOnHand: Number(item.quantityOnHand), lowStockThreshold: Number(item.lowStockThreshold) }));
  }

  movementText(t: string): string {
    return movementLabel(t);
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.api.listItems({ perPage: 50, lowStock: this.lowOnly || undefined }).subscribe({
      next: (r: any) => {
        this.loading = false;
        this.items = r?.data ?? [];
      },
      error: (e: any) => {
        this.loading = false;
        this.loadError = inventoryErrorMessage(e);
      },
    });
  }

  create(): void {
    this.formError = null;
    const gate = requireOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (!gate.ok) {
      this.formError = gate.message;
      return;
    }
    const invalid = validateItemInput({
      name: this.form.name,
      sellingPrice: Number(this.form.sellingPrice),
      costPrice: Number(this.form.costPrice),
      quantityOnHand: Number(this.form.quantityOnHand),
      lowStockThreshold: Number(this.form.lowStockThreshold),
    });
    if (invalid) {
      this.formError = invalid;
      return;
    }
    this.creating = true;
    this.api
      .createItem({
        name: this.form.name.trim(),
        sku: this.form.sku.trim() || null,
        sellingPrice: Number(this.form.sellingPrice),
        costPrice: Number(this.form.costPrice) || 0,
        quantityOnHand: Math.floor(Number(this.form.quantityOnHand)) || 0,
        lowStockThreshold: Math.floor(Number(this.form.lowStockThreshold)) || 0,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.form = { name: '', sku: '', sellingPrice: 0, costPrice: 0, quantityOnHand: 0, lowStockThreshold: 0 };
          this.load();
        },
        error: (e: any) => {
          this.creating = false;
          this.formError = inventoryErrorMessage(e);
        },
      });
  }

  receive(item: any): void {
    const qty = Math.floor(Number(this.stockQty[item.id]));
    const invalid = validateStockDelta(qty, 'receive');
    if (invalid) {
      this.rowError[item.id] = invalid;
      return;
    }
    this.mutate(item, this.api.receive(item.id, qty));
  }

  adjust(item: any, sign: 1 | -1): void {
    const qty = Math.floor(Number(this.stockQty[item.id] ?? 1)) || 1;
    const delta = sign * Math.abs(qty);
    const invalid = validateStockDelta(delta, 'adjust');
    if (invalid) {
      this.rowError[item.id] = invalid;
      return;
    }
    this.mutate(item, this.api.adjust(item.id, delta));
  }

  private mutate(item: any, req: { subscribe: (o: any) => void }): void {
    delete this.rowError[item.id];
    const gate = requireOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (!gate.ok) {
      this.rowError[item.id] = gate.message;
      return;
    }
    req.subscribe({
      next: () => this.load(),
      error: (e: any) => {
        this.rowError[item.id] = inventoryErrorMessage(e);
      },
    });
  }

  toggle(item: any, active: boolean): void {
    const gate = requireOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    if (!gate.ok) {
      this.rowError[item.id] = gate.message;
      return;
    }
    (active ? this.api.activate(item.id) : this.api.deactivate(item.id)).subscribe({
      next: () => this.load(),
      error: (e: any) => {
        this.rowError[item.id] = inventoryErrorMessage(e);
      },
    });
  }

  loadDetail(id: string): void {
    this.api.getItem(id).subscribe({
      next: (r: any) => {
        this.detail = r?.data ?? null;
      },
      error: () => {},
    });
    this.api.movements(id).subscribe({
      next: (r: any) => {
        this.movements = r?.data ?? [];
      },
      error: () => {},
    });
  }
}

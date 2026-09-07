/**
 * Slice 14 — POS & inventory.
 *
 * Production foundation for provider-side operational tooling:
 * inventory CRUD + server-authoritative stock movements, and POS sales
 * (service/product/mixed) that are NOT bookings — no booking, payment or
 * cash-ledger rows are ever created here.
 *
 * Prisma is mocked at the module boundary with in-memory stores; the real
 * route → service → notification code runs unmodified, including
 * Serializable transactions (the mock serializes them, faithfully
 * simulating SELECT ... FOR UPDATE row locking). Frontend contracts import
 * the REAL web/mobile services and utils.
 */
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { of } from 'rxjs';

function token(sub: string) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign({ uuid: sub, email: `${sub}@test.local`, sub }, secret, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
  } as any);
}
const auth = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });

// ---- mocks ----
const mockUserFindUnique = jest.fn();
const mockProfileFindUnique = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockBusinessUnitFindUnique = jest.fn();
const mockStaffFindMany = jest.fn();
const mockTeamMemberFindMany = jest.fn();
const mockTeamFindMany = jest.fn();
const mockItemFindUnique = jest.fn();
const mockItemFindFirst = jest.fn();
const mockItemCount = jest.fn();
const mockItemFindMany = jest.fn();
const mockItemCreate = jest.fn();
const mockItemUpdate = jest.fn();
const mockMovementCreate = jest.fn();
const mockMovementCount = jest.fn();
const mockMovementFindMany = jest.fn();
const mockSaleFindUnique = jest.fn();
const mockSaleCount = jest.fn();
const mockSaleFindMany = jest.fn();
const mockSaleCreate = jest.fn();
const mockSaleUpdate = jest.fn();
const mockLineCreate = jest.fn();
const mockLineFindMany = jest.fn();
const mockServiceFindMany = jest.fn();
const mockCashAccountFindUnique = jest.fn();
const mockAdminFindMany = jest.fn();
const mockAuditCreate = jest.fn();
const mockNotifCreate = jest.fn();
const mockNotifFindUnique = jest.fn();
const mockNotifPrefFindUnique = jest.fn();
const mockPaymentCreate = jest.fn();
const mockCashLedgerCreate = jest.fn();
const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    providerProfile: { findUnique: (...a: any[]) => (mockProfileFindUnique as any)(...a) },
    business: { findMany: (...a: any[]) => (mockBusinessFindMany as any)(...a) },
    businessUnit: {
      findMany: (...a: any[]) => (mockBusinessUnitFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockBusinessUnitFindUnique as any)(...a),
    },
    businessStaff: { findMany: (...a: any[]) => (mockStaffFindMany as any)(...a) },
    teamMember: { findMany: (...a: any[]) => (mockTeamMemberFindMany as any)(...a) },
    team: { findMany: (...a: any[]) => (mockTeamFindMany as any)(...a) },
    inventoryItem: {
      findUnique: (...a: any[]) => (mockItemFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockItemFindFirst as any)(...a),
      count: (...a: any[]) => (mockItemCount as any)(...a),
      findMany: (...a: any[]) => (mockItemFindMany as any)(...a),
      create: (...a: any[]) => (mockItemCreate as any)(...a),
      update: (...a: any[]) => (mockItemUpdate as any)(...a),
    },
    inventoryMovement: {
      create: (...a: any[]) => (mockMovementCreate as any)(...a),
      count: (...a: any[]) => (mockMovementCount as any)(...a),
      findMany: (...a: any[]) => (mockMovementFindMany as any)(...a),
    },
    posSale: {
      findUnique: (...a: any[]) => (mockSaleFindUnique as any)(...a),
      count: (...a: any[]) => (mockSaleCount as any)(...a),
      findMany: (...a: any[]) => (mockSaleFindMany as any)(...a),
      create: (...a: any[]) => (mockSaleCreate as any)(...a),
      update: (...a: any[]) => (mockSaleUpdate as any)(...a),
    },
    posSaleLine: {
      create: (...a: any[]) => (mockLineCreate as any)(...a),
      findMany: (...a: any[]) => (mockLineFindMany as any)(...a),
    },
    service: { findMany: (...a: any[]) => (mockServiceFindMany as any)(...a) },
    providerCashAccount: { findUnique: (...a: any[]) => (mockCashAccountFindUnique as any)(...a) },
    adminSetting: { findMany: (...a: any[]) => (mockAdminFindMany as any)(...a) },
    payment: { create: (...a: any[]) => (mockPaymentCreate as any)(...a) },
    cashLedgerEntry: { create: (...a: any[]) => (mockCashLedgerCreate as any)(...a) },
    notification: {
      create: (...a: any[]) => (mockNotifCreate as any)(...a),
      findUnique: (...a: any[]) => (mockNotifFindUnique as any)(...a),
    },
    notificationPreference: { findUnique: (...a: any[]) => (mockNotifPrefFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
    $queryRaw: (...a: any[]) => (mockQueryRaw as any)(...a),
  },
}));

import { app } from '../src/app';

// ---- in-memory stores ----
let items: Record<string, any> = {};
let movements: any[] = [];
let sales: Record<string, any> = {};
let saleLines: Record<string, any[]> = {};
let audits: any[] = [];
let notifs: any[] = [];
let cashAccounts: Record<string, any> = {};
let itemSeq = 0;
let saleSeq = 0;
let lineSeq = 0;
let movSeq = 0;

function profile(id: string, userId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    status: 'ACTIVE',
    tier: { code: 'T1' },
    isStudent: false,
    studentVerificationStatus: 'UNVERIFIED',
    acceptCash: true,
    ...over,
  };
}

const PROFILES: Record<string, any> = {};
const SERVICES: Record<string, any> = {};

function mkItem(over: Record<string, unknown> = {}) {
  itemSeq += 1;
  return {
    id: `item-${itemSeq}`,
    uuid: `uuid-item-${itemSeq}`,
    providerId: 'prov-1',
    businessUnitId: null,
    sku: null,
    name: `Product ${itemSeq}`,
    description: null,
    unit: 'unit',
    costPrice: 20,
    sellingPrice: 50,
    currency: 'ZAR',
    quantityOnHand: 10,
    lowStockThreshold: 3,
    isActive: true,
    imageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// Serializable simulation: queue transactions like FOR UPDATE row locks would.
let txQueue: Promise<unknown> = Promise.resolve();

const tx = {
  $queryRaw: async () => [],
  providerProfile: { findUnique: async (args: any) => PROFILES[args?.where?.id] ?? PROFILES[args?.where?.userId] ?? null },
  service: {
    findMany: async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      return ids.map((id) => SERVICES[id]).filter(Boolean);
    },
  },
  inventoryItem: {
    findUnique: async ({ where }: any) => items[where?.id] ?? null,
    findFirst: async ({ where }: any) => {
      const all = Object.values(items);
      return (
        all.find((i: any) => {
          if (where?.providerId && i.providerId !== where.providerId) return false;
          if (where?.sku !== undefined && i.sku !== where.sku) return false;
          if (where?.NOT?.id && i.id === where.NOT.id) return false;
          return true;
        }) ?? null
      );
    },
    create: async ({ data }: any) => {
      itemSeq += 1;
      const row = { id: `item-${itemSeq}`, uuid: `uuid-item-${itemSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      items[row.id] = row;
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = items[where?.id];
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  },
  inventoryMovement: {
    create: async ({ data }: any) => {
      movSeq += 1;
      const row = { id: `mov-${movSeq}`, createdAt: new Date(), ...data };
      movements.push(row);
      return row;
    },
  },
  posSale: {
    findUnique: async ({ where, include }: any) => {
      const s = Object.values(sales).find((x: any) =>
        where?.id ? x.id === where.id : x.idempotencyKey && x.idempotencyKey === where?.idempotencyKey,
      ) as any;
      if (!s) return null;
      return include?.lines ? { ...s, lines: saleLines[s.id] ?? [] } : s;
    },
    create: async ({ data }: any) => {
      if (data.idempotencyKey && Object.values(sales).some((s: any) => s.idempotencyKey === data.idempotencyKey)) {
        const e: any = new Error('Unique constraint failed');
        e.code = 'P2002';
        throw e;
      }
      saleSeq += 1;
      const row = { id: `sale-${saleSeq}`, uuid: `uuid-sale-${saleSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      sales[row.id] = row;
      saleLines[row.id] = [];
      return row;
    },
    update: async ({ where, data, include }: any) => {
      const row = sales[where?.id];
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return include?.lines ? { ...row, lines: saleLines[row.id] ?? [] } : row;
    },
  },
  posSaleLine: {
    create: async ({ data }: any) => {
      lineSeq += 1;
      const row = { id: `line-${lineSeq}`, createdAt: new Date(), ...data };
      (saleLines[data.saleId] = saleLines[data.saleId] ?? []).push(row);
      return row;
    },
    findMany: async ({ where }: any) => saleLines[where?.saleId] ?? [],
  },
  providerCashAccount: {
    findUnique: async ({ where }: any) => cashAccounts[where?.providerId] ?? null,
  },
  auditLog: {
    create: async ({ data }: any) => {
      audits.push(data);
      return data;
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  items = {};
  movements = [];
  sales = {};
  saleLines = {};
  audits = [];
  notifs = [];
  cashAccounts = {};
  itemSeq = 0;
  saleSeq = 0;
  lineSeq = 0;
  movSeq = 0;
  txQueue = Promise.resolve();
  for (const k of Object.keys(PROFILES)) delete PROFILES[k];
  for (const k of Object.keys(SERVICES)) delete SERVICES[k];

  PROFILES['prov-1'] = profile('prov-1', 'user-prov-1');
  PROFILES['user-prov-1'] = PROFILES['prov-1'];
  PROFILES['prov-2'] = profile('prov-2', 'user-prov-2');
  PROFILES['user-prov-2'] = PROFILES['prov-2'];

  SERVICES['svc-1'] = { id: 'svc-1', providerId: 'prov-1', businessUnitId: null, name: 'Fade', price: 200, status: 'ACTIVE' };
  SERVICES['svc-paused'] = { id: 'svc-paused', providerId: 'prov-1', businessUnitId: null, name: 'Paused Cut', price: 100, status: 'PAUSED' };
  SERVICES['svc-other'] = { id: 'svc-other', providerId: 'prov-2', businessUnitId: null, name: 'Other Cut', price: 150, status: 'ACTIVE' };

  mockUserFindUnique.mockImplementation(async ({ where }: any) => ({ id: where.id, status: 'ACTIVE' }));
  mockProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.userId) return PROFILES[where.userId] ?? null;
    return PROFILES[where?.id] ?? null;
  });
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockResolvedValue([]);
  mockBusinessUnitFindUnique.mockResolvedValue(null);
  mockStaffFindMany.mockResolvedValue([]);
  mockTeamMemberFindMany.mockResolvedValue([]);
  mockTeamFindMany.mockResolvedValue([]);
  mockAdminFindMany.mockResolvedValue([]);
  mockCashAccountFindUnique.mockImplementation(async ({ where }: any) => cashAccounts[where?.providerId] ?? null);

  mockItemFindUnique.mockImplementation(async ({ where }: any) => items[where?.id] ?? null);
  mockItemFindFirst.mockImplementation(async ({ where }: any) => {
    const all = Object.values(items);
    return (
      all.find((i: any) => {
        if (where?.providerId && i.providerId !== where.providerId) return false;
        if (where?.sku !== undefined && i.sku !== where.sku) return false;
        if (where?.NOT?.id && i.id === where.NOT.id) return false;
        return true;
      }) ?? null
    );
  });
  mockItemCount.mockImplementation(async ({ where }: any) => {
    let all = Object.values(items);
    const ors = where?.OR as any[] | undefined;
    if (ors) all = all.filter((i: any) => ors.some((o) => (o.providerId?.in ? o.providerId.in.includes(i.providerId) : true)));
    if (where?.isActive !== undefined) all = all.filter((i: any) => i.isActive === where.isActive);
    return all.length;
  });
  mockItemFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
    let all = Object.values(items);
    const ors = where?.OR as any[] | undefined;
    if (ors) all = all.filter((i: any) => ors.some((o) => (o.providerId?.in ? o.providerId.in.includes(i.providerId) : true)));
    if (where?.isActive !== undefined) all = all.filter((i: any) => i.isActive === where.isActive);
    return all.slice(skip, skip + take);
  });
  mockItemCreate.mockImplementation(async ({ data }: any) => tx.inventoryItem.create({ data }));
  mockItemUpdate.mockImplementation(async (args: any) => tx.inventoryItem.update(args));
  mockMovementCreate.mockImplementation(async (args: any) => tx.inventoryMovement.create(args));
  mockMovementCount.mockImplementation(async ({ where }: any) => movements.filter((m) => (where?.itemId ? m.itemId === where.itemId : true)).length);
  mockMovementFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
    let all = movements.filter((m) => (where?.itemId ? m.itemId === where.itemId : true));
    if (where?.movementType) all = all.filter((m) => m.movementType === where.movementType);
    return all.slice(skip, skip + take);
  });
  mockSaleFindUnique.mockImplementation(async ({ where, include }: any) => tx.posSale.findUnique({ where, include }));
  mockSaleCount.mockResolvedValue(0);
  mockSaleFindMany.mockImplementation(async ({ include, skip = 0, take = 20 }: any) => {
    const all = Object.values(sales).slice(skip, skip + take);
    return include?.lines ? all.map((s: any) => ({ ...s, lines: saleLines[s.id] ?? [] })) : all;
  });
  mockSaleCreate.mockImplementation(async (args: any) => tx.posSale.create(args));
  mockSaleUpdate.mockImplementation(async (args: any) => tx.posSale.update(args));
  mockLineCreate.mockImplementation(async (args: any) => tx.posSaleLine.create(args));
  mockLineFindMany.mockImplementation(async (args: any) => tx.posSaleLine.findMany(args));
  mockServiceFindMany.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where?.id?.in ?? [];
    return ids.map((id) => SERVICES[id]).filter(Boolean);
  });
  mockPaymentCreate.mockImplementation(async () => {
    throw new Error('POS must never create booking Payment rows');
  });
  mockCashLedgerCreate.mockImplementation(async () => {
    throw new Error('POS must never write cash ledger rows');
  });
  mockAuditCreate.mockImplementation(async ({ data }: any) => {
    audits.push(data);
    return data;
  });
  mockNotifCreate.mockImplementation(async ({ data }: any) => {
    const row = { id: `notif-${notifs.length + 1}`, status: 'UNREAD', channel: 'IN_APP', createdAt: new Date(), ...data };
    notifs.push(row);
    return row;
  });
  mockNotifFindUnique.mockResolvedValue(null);
  mockNotifPrefFindUnique.mockResolvedValue(null);
  mockQueryRaw.mockResolvedValue([]);
  // Serialized transactions — simulates Serializable + FOR UPDATE row locks.
  mockTransaction.mockImplementation((cb: any) => {
    const run = () => (cb as any)(tx);
    const p = txQueue.then(run, run);
    txQueue = p.catch(() => undefined);
    return p;
  });
});

function seedItem(over: Record<string, unknown> = {}) {
  const row = mkItem(over);
  items[row.id] = row;
  return row;
}

function auditActions() {
  return audits.map((a) => a.action);
}

// ══════════════════════════════════════════════════════════════════
// INVENTORY — CRUD
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — inventory CRUD', () => {
  it('creates an item with opening balance + RECEIVED movement + audit', async () => {
    const res = await request(app)
      .post('/api/v1/pos/inventory')
      .set(auth('user-prov-1'))
      .send({ name: 'Shampoo', sellingPrice: 50, quantityOnHand: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.quantityOnHand).toBe(5);
    expect(res.body.data.isLowStock).toBe(false);
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe('RECEIVED');
    expect(movements[0].resultingQuantity).toBe(5);
    expect(auditActions()).toContain('INVENTORY_ITEM_CREATED');
  });

  it('rejects missing name and negative prices', async () => {
    const r1 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ sellingPrice: 10 });
    expect(r1.status).toBe(422);
    const r2 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ name: 'X', sellingPrice: -5 });
    expect(r2.status).toBe(422);
  });

  it('rejects non-integer quantities and quantity tampering via update', async () => {
    const r1 = await request(app)
      .post('/api/v1/pos/inventory')
      .set(auth('user-prov-1'))
      .send({ name: 'X', sellingPrice: 10, quantityOnHand: 2.5 });
    expect(r1.status).toBe(422);
    const item = seedItem();
    const r2 = await request(app).patch(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1')).send({ quantityOnHand: 999 });
    expect(r2.status).toBe(422);
  });

  it('rejects ownership/isActive mass-assignment on update', async () => {
    const item = seedItem();
    const r1 = await request(app).patch(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1')).send({ isActive: false });
    expect(r1.status).toBe(422);
    const r2 = await request(app).patch(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1')).send({ providerId: 'prov-2' });
    expect(r2.status).toBe(422);
  });

  it('enforces per-provider SKU uniqueness but allows reuse across providers', async () => {
    const r1 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ name: 'A', sku: 'SH-001', sellingPrice: 10 });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ name: 'B', sku: 'SH-001', sellingPrice: 12 });
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('SKU_IN_USE');
    const r3 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-2')).send({ name: 'C', sku: 'SH-001', sellingPrice: 12 });
    expect(r3.status).toBe(201);
  });

  it('lists with pagination bounds and low-stock filter', async () => {
    seedItem({ providerId: 'prov-1', quantityOnHand: 1, lowStockThreshold: 5 });
    seedItem({ providerId: 'prov-1', quantityOnHand: 50, lowStockThreshold: 5 });
    const bad = await request(app).get('/api/v1/pos/inventory?perPage=999').set(auth('user-prov-1'));
    expect(bad.status).toBe(422);
    const badPage = await request(app).get('/api/v1/pos/inventory?page=0').set(auth('user-prov-1'));
    expect(badPage.status).toBe(422);
    const low = await request(app).get('/api/v1/pos/inventory?lowStock=true').set(auth('user-prov-1'));
    expect(low.status).toBe(200);
    expect(low.body.data.every((i: any) => i.isLowStock)).toBe(true);
  });

  it('returns item detail and safe-404s cross-provider items', async () => {
    const item = seedItem({ providerId: 'prov-1' });
    const ok = await request(app).get(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1'));
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(item.id);
    const other = await request(app).get(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-2'));
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('INVENTORY_ITEM_NOT_FOUND');
  });

  it('updates price without touching historical sales (snapshot preserved)', async () => {
    const item = seedItem({ providerId: 'prov-1', sellingPrice: 50, quantityOnHand: 10 });
    const sale = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'snap-key-001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 1 }],
    });
    expect(sale.status).toBe(201);
    const upd = await request(app).patch(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1')).send({ sellingPrice: 999 });
    expect(upd.status).toBe(200);
    expect(auditActions()).toContain('INVENTORY_ITEM_UPDATED');
    const got = await request(app).get(`/api/v1/pos/sales/${sale.body.data.id}`).set(auth('user-prov-1'));
    expect(got.body.data.lines[0].unitPrice).toBe(50);
    expect(got.body.data.totalAmount).toBe(50);
  });

  it('activates and deactivates with audit', async () => {
    const item = seedItem({ providerId: 'prov-1' });
    const off = await request(app).post(`/api/v1/pos/inventory/${item.id}/deactivate`).set(auth('user-prov-1'));
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    const on = await request(app).post(`/api/v1/pos/inventory/${item.id}/activate`).set(auth('user-prov-1'));
    expect(on.status).toBe(200);
    expect(on.body.data.isActive).toBe(true);
    expect(auditActions()).toContain('INVENTORY_ITEM_DEACTIVATED');
    expect(auditActions()).toContain('INVENTORY_ITEM_ACTIVATED');
  });

  it('rejects forged businessUnitId on create', async () => {
    const res = await request(app)
      .post('/api/v1/pos/inventory')
      .set(auth('user-prov-1'))
      .send({ name: 'X', sellingPrice: 10, businessUnitId: 'unit-evil' });
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════
// STOCK MOVEMENTS
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — stock movements', () => {
  it('receives stock with resulting balance + audit', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 4 });
    const res = await request(app).post(`/api/v1/pos/inventory/${item.id}/receive`).set(auth('user-prov-1')).send({ quantity: 6, reason: 'Supplier drop' });
    expect(res.status).toBe(200);
    expect(res.body.data.item.quantityOnHand).toBe(10);
    expect(res.body.data.movement.movementType).toBe('RECEIVED');
    expect(res.body.data.movement.resultingQuantity).toBe(10);
    expect(auditActions()).toContain('STOCK_RECEIVED');
  });

  it('adjusts up and down with audit trail', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 10 });
    const up = await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: 3 });
    expect(up.body.data.item.quantityOnHand).toBe(13);
    expect(up.body.data.movement.movementType).toBe('ADJUST_INCREASE');
    const down = await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: -5 });
    expect(down.body.data.item.quantityOnHand).toBe(8);
    expect(down.body.data.movement.movementType).toBe('ADJUST_DECREASE');
    expect(auditActions().filter((a) => a === 'STOCK_ADJUSTED')).toHaveLength(2);
  });

  it('blocks negative stock and zero/non-integer deltas', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 2 });
    const neg = await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: -5 });
    expect(neg.status).toBe(422);
    expect(neg.body.error.code).toBe('NEGATIVE_STOCK');
    const zero = await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: 0 });
    expect(zero.status).toBe(422);
    const frac = await request(app).post(`/api/v1/pos/inventory/${item.id}/receive`).set(auth('user-prov-1')).send({ quantity: 1.5 });
    expect(frac.status).toBe(422);
    expect(items[item.id].quantityOnHand).toBe(2);
  });

  it('exposes auditable movement history with type filter', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 5 });
    await request(app).post(`/api/v1/pos/inventory/${item.id}/receive`).set(auth('user-prov-1')).send({ quantity: 2 });
    await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: -1 });
    const all = await request(app).get(`/api/v1/pos/inventory/${item.id}/movements`).set(auth('user-prov-1'));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0]).toMatchObject({ itemId: item.id, actorUserId: 'user-prov-1' });
    const recv = await request(app).get(`/api/v1/pos/inventory/${item.id}/movements?movementType=RECEIVED`).set(auth('user-prov-1'));
    expect(recv.body.data.every((m: any) => m.movementType === 'RECEIVED')).toBe(true);
    const bad = await request(app).get(`/api/v1/pos/inventory/${item.id}/movements?movementType=BOGUS`).set(auth('user-prov-1'));
    expect(bad.status).toBe(422);
  });

  it('hides movement history cross-provider', async () => {
    const item = seedItem({ providerId: 'prov-1' });
    const res = await request(app).get(`/api/v1/pos/inventory/${item.id}/movements`).set(auth('user-prov-2'));
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════
// POS SALES
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — POS sales', () => {
  it('records a service-only cash sale with server-side totals', async () => {
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'svc-sale-001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 2 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(400);
    expect(res.body.data.lines[0]).toMatchObject({ lineType: 'SERVICE', nameSnapshot: 'Fade', unitPrice: 200, quantity: 2, lineTotal: 400 });
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.commissionEligible).toBe(false);
    expect(res.body.data.commissionRate).toBe(25);
    expect(auditActions()).toContain('POS_SALE_CREATED');
  });

  it('ignores stale client prices and totals (server recomputes)', async () => {
    const item = seedItem({ providerId: 'prov-1', sellingPrice: 50, quantityOnHand: 10 });
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'stale-price-01',
      subtotal: 1,
      totalAmount: 1,
      commissionAmount: 0,
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2, unitPrice: 1, lineTotal: 2 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(100);
    expect(res.body.data.lines[0].unitPrice).toBe(50);
  });

  it('records a product-only sale and deducts stock with SALE movement', async () => {
    const item = seedItem({ providerId: 'prov-1', sellingPrice: 30, quantityOnHand: 8 });
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'eft',
      paymentStatus: 'PENDING',
      idempotencyKey: 'prod-sale-001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 3 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(90);
    expect(items[item.id].quantityOnHand).toBe(5);
    const saleMovs = movements.filter((m) => m.referenceId === res.body.data.id);
    expect(saleMovs).toHaveLength(1);
    expect(saleMovs[0]).toMatchObject({ movementType: 'SALE', quantityDelta: -3, resultingQuantity: 5 });
  });

  it('records a mixed service + product sale', async () => {
    const item = seedItem({ providerId: 'prov-1', sellingPrice: 25, quantityOnHand: 6 });
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'waasha_payment',
      idempotencyKey: 'mixed-sale-001',
      lines: [
        { lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 },
        { lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(250);
    expect(items[item.id].quantityOnHand).toBe(4);
  });

  it('rejects insufficient stock without partial deduction', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 2 });
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'short-stock-1',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 5 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(items[item.id].quantityOnHand).toBe(2);
  });

  it('aggregates demand across repeated lines for the same item', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 3 });
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'repeat-lines-1',
      lines: [
        { lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 },
        { lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects inactive products and unavailable services', async () => {
    const inactive = seedItem({ providerId: 'prov-1', isActive: false, quantityOnHand: 10 });
    const r1 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'inactive-prod-1',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: inactive.id, quantity: 1 }],
    });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('ITEM_INACTIVE');
    const r2 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'paused-svc-1x',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-paused', quantity: 1 }],
    });
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('SERVICE_NOT_AVAILABLE');
  });

  it('safe-404s foreign services and inventory', async () => {
    const r1 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'foreign-svc-11',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-other', quantity: 1 }],
    });
    expect(r1.status).toBe(404);
    const foreign = seedItem({ providerId: 'prov-2', quantityOnHand: 9 });
    const r2 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'foreign-prod-1',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: foreign.id, quantity: 1 }],
    });
    expect(r2.status).toBe(404);
  });

  it('is idempotent: retry returns the original sale without double deduction', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 10 });
    const body = {
      paymentMethod: 'cash',
      idempotencyKey: 'idem-retry-001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 }],
    };
    const first = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.idempotent).toBe(true);
    expect(items[item.id].quantityOnHand).toBe(8);
    expect(movements.filter((m) => m.referenceId === first.body.data.id && m.movementType === 'SALE')).toHaveLength(1);
  });

  it('supports header idempotency keys', async () => {
    const body = { paymentMethod: 'cash', lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }] };
    const first = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).set('Idempotency-Key', 'hdr-key-abc123').send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).set('Idempotency-Key', 'hdr-key-abc123').send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.idempotent).toBe(true);
  });

  it('prevents concurrent oversell of the same inventory', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 2 });
    const mkBody = (key: string) => ({
      paymentMethod: 'cash',
      idempotencyKey: key,
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 }],
    });
    const [a, b] = await Promise.all([
      request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send(mkBody('conc-key-aaa1')),
      request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send(mkBody('conc-key-bbb2')),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);
    const failed = a.status === 422 ? a : b;
    expect(failed.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(items[item.id].quantityOnHand).toBe(0);
  });

  it('validates sale shape: lines required, quantities bounded, methods known', async () => {
    const empty = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({ paymentMethod: 'cash', lines: [] });
    expect(empty.status).toBe(422);
    const qty = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 0 }],
    });
    expect(qty.status).toBe(422);
    const method = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'card',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(method.status).toBe(422);
  });

  it('enforces payment-state rules per method', async () => {
    const cashPending = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      paymentStatus: 'PENDING',
      idempotencyKey: 'cash-pend-001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(cashPending.status).toBe(422);
    const eftPending = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'eft',
      paymentStatus: 'PENDING',
      idempotencyKey: 'eft-pend-0001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(eftPending.status).toBe(201);
    expect(eftPending.body.data.paymentStatus).toBe('PENDING');
  });

  it('never creates booking payments or cash ledger entries (payment separation)', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 5 });
    await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'separation-01',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 1 }],
    });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(mockCashLedgerCreate).not.toHaveBeenCalled();
  });

  it('blocks cash when the provider does not accept it', async () => {
    PROFILES['prov-1'].acceptCash = false;
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'no-cash-00001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CASH_NOT_ACCEPTED');
  });

  it('blocks cash sales that would breach the liability cap (advisory, no ledger write)', async () => {
    cashAccounts['prov-1'] = { providerId: 'prov-1', outstandingCommission: 990 };
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'cap-block-0001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CASH_CAP_EXCEEDED');
    expect(mockCashLedgerCreate).not.toHaveBeenCalled();
  });

  it('lists and retrieves sales with filters', async () => {
    const created = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'list-sale-001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    mockSaleCount.mockResolvedValue(1);
    const list = await request(app).get('/api/v1/pos/sales?paymentMethod=cash').set(auth('user-prov-1'));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    const bad = await request(app).get('/api/v1/pos/sales?paymentMethod=bogus').set(auth('user-prov-1'));
    expect(bad.status).toBe(422);
    const got = await request(app).get(`/api/v1/pos/sales/${created.body.data.id}`).set(auth('user-prov-1'));
    expect(got.status).toBe(200);
    const foreign = await request(app).get(`/api/v1/pos/sales/${created.body.data.id}`).set(auth('user-prov-2'));
    expect(foreign.status).toBe(404);
  });

  it('reverses a sale once, restoring stock; second reversal is rejected', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 5 });
    const created = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'reverse-me-001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 }],
    });
    expect(items[item.id].quantityOnHand).toBe(3);
    const rev = await request(app).post(`/api/v1/pos/sales/${created.body.data.id}/reverse`).set(auth('user-prov-1')).send({ reason: 'Customer return' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.status).toBe('REVERSED');
    expect(items[item.id].quantityOnHand).toBe(5);
    expect(movements.filter((m) => m.referenceId === created.body.data.id && m.movementType === 'RETURN')).toHaveLength(1);
    expect(auditActions()).toContain('POS_SALE_REVERSED');
    const again = await request(app).post(`/api/v1/pos/sales/${created.body.data.id}/reverse`).set(auth('user-prov-1')).send({});
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('SALE_NOT_REVERSIBLE');
  });

  it('rejects forged businessUnitId on sales', async () => {
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      businessUnitId: 'unit-evil',
      idempotencyKey: 'evil-unit-sale',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════
// SECURITY
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — security', () => {
  it('requires authentication on all POS/inventory routes', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['get', '/api/v1/pos/inventory'],
      ['post', '/api/v1/pos/inventory', { name: 'X', sellingPrice: 1 }],
      ['get', '/api/v1/pos/inventory/abc'],
      ['patch', '/api/v1/pos/inventory/abc', { name: 'Y' }],
      ['post', '/api/v1/pos/inventory/abc/receive', { quantity: 1 }],
      ['post', '/api/v1/pos/inventory/abc/adjust', { delta: 1 }],
      ['get', '/api/v1/pos/inventory/abc/movements'],
      ['post', '/api/v1/pos/sales', { paymentMethod: 'cash', lines: [] }],
      ['get', '/api/v1/pos/sales'],
      ['get', '/api/v1/pos/sales/abc'],
      ['post', '/api/v1/pos/sales/abc/reverse', {}],
    ];
    for (const [method, url, body] of routes) {
      const t = (request(app) as any)[method](url);
      const res = body ? await t.send(body) : await t;
      expect(res.status).toBe(401);
    }
  });

  it('rejects expired/invalid tokens', async () => {
    const res = await request(app).get('/api/v1/pos/inventory').set({ Authorization: 'Bearer not-a-token' });
    expect(res.status).toBe(401);
  });

  it('rejects string-typed money and quantities (no coercion exploits)', async () => {
    const r1 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ name: 'X', sellingPrice: '50' });
    expect(r1.status).toBe(422);
    const r2 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: '2' }],
    });
    expect(r2.status).toBe(422);
  });

  it('never exposes other tenants via list endpoints', async () => {
    seedItem({ providerId: 'prov-2', name: 'Foreign Goods' });
    const res = await request(app).get('/api/v1/pos/inventory').set(auth('user-prov-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.every((i: any) => i.name !== 'Foreign Goods')).toBe(true);
  });

  it('sanitizes errors (no stack traces or SQL leakage)', async () => {
    const res = await request(app).get('/api/v1/pos/inventory/does-not-exist').set(auth('user-prov-1'));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|prisma|SELECT|Error:/i);
  });
});

// ══════════════════════════════════════════════════════════════════
// LOW-STOCK NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — low-stock hooks', () => {
  it('emits LOW_STOCK when a sale crosses the threshold', async () => {
    const item = seedItem({ providerId: 'prov-1', name: 'Gel', quantityOnHand: 4, lowStockThreshold: 3 });
    await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'low-cross-001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 2 }],
    });
    await new Promise((r) => setTimeout(r, 10));
    const lows = notifs.filter((n) => n.type === 'LOW_STOCK');
    expect(lows).toHaveLength(1);
    expect(lows[0].audience).toBe('PROVIDER');
    expect(lows[0].recipientUserId).toBe('user-prov-1');
  });

  it('does not repeat alerts while already low, and stays silent when healthy', async () => {
    const low = seedItem({ providerId: 'prov-1', name: 'Low', quantityOnHand: 2, lowStockThreshold: 5 });
    await request(app).post(`/api/v1/pos/inventory/${low.id}/adjust`).set(auth('user-prov-1')).send({ delta: -1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(notifs.filter((n) => n.type === 'LOW_STOCK')).toHaveLength(0);
    const healthy = seedItem({ providerId: 'prov-1', name: 'Healthy', quantityOnHand: 20, lowStockThreshold: 3 });
    await request(app).post(`/api/v1/pos/inventory/${healthy.id}/receive`).set(auth('user-prov-1')).send({ quantity: 5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(notifs.filter((n) => n.type === 'LOW_STOCK')).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// EXTENDED COVERAGE — tenant scopes, finance config, edge cases
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — extended coverage', () => {
  it('creates items under an owned T3 business unit', async () => {
    PROFILES['prov-1'].tier = { code: 'T3' };
    mockBusinessFindMany.mockImplementation(async ({ where }: any) =>
      where?.ownerProviderId === 'user-prov-1' ? [{ id: 'biz-1' }] : [],
    );
    mockBusinessUnitFindMany.mockImplementation(async ({ where }: any) =>
      where?.businessId?.in?.includes('biz-1') ? [{ id: 'unit-1' }] : [],
    );
    const res = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({
      name: 'Unit Stock',
      sellingPrice: 40,
      businessUnitId: 'unit-1',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.businessUnitId).toBe('unit-1');
  });

  it('grants staff-scoped unit access via existing BusinessStaff rows', async () => {
    mockStaffFindMany.mockImplementation(async ({ where }: any) =>
      where?.providerId === 'prov-1' ? [{ businessUnitId: 'unit-9' }] : [],
    );
    const res = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({
      name: 'Staff Stock',
      sellingPrice: 15,
      businessUnitId: 'unit-9',
    });
    expect(res.status).toBe(201);
  });

  it('rejects T3 cash sales without business context', async () => {
    PROFILES['prov-1'].tier = { code: 'T3' };
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 't3-no-ctx-001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CASH_NOT_ACCEPTED');
  });

  it('quotes verified-student commission from config (no hard-coded rate in logic)', async () => {
    PROFILES['prov-1'].isStudent = true;
    PROFILES['prov-1'].studentVerificationStatus = 'VERIFIED';
    const res = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'student-quote1',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.commissionRate).toBe(16);
    expect(res.body.data.commissionAmount).toBe(32);
    expect(res.body.data.commissionEligible).toBe(false);
  });

  it('defaults EFT sales to PENDING and records waasha_payment as PAID', async () => {
    const eft = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'eft',
      idempotencyKey: 'eft-default-01',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(eft.status).toBe(201);
    expect(eft.body.data.paymentStatus).toBe('PENDING');
    const wp = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'waasha_payment',
      idempotencyKey: 'wp-paid-000001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(wp.status).toBe(201);
    expect(wp.body.data.paymentStatus).toBe('PAID');
  });

  it('rejects oversized sales, quantities and short idempotency keys', async () => {
    const lines = Array.from({ length: 51 }, () => ({ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }));
    const big = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({ paymentMethod: 'cash', idempotencyKey: 'big-sale-0001', lines });
    expect(big.status).toBe(422);
    const qty = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'qty-big-000001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1001 }],
    });
    expect(qty.status).toBe(422);
    const key = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'short',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(key.status).toBe(422);
  });

  it('safe-404s unknown services and sales', async () => {
    const r1 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'ghost-svc-0001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-ghost', quantity: 1 }],
    });
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe('SERVICE_NOT_FOUND');
    const r2 = await request(app).get('/api/v1/pos/sales/sale-ghost').set(auth('user-prov-1'));
    expect(r2.status).toBe(404);
    const r3 = await request(app).post('/api/v1/pos/sales/sale-ghost/reverse').set(auth('user-prov-1')).send({});
    expect(r3.status).toBe(404);
  });

  it('rejects reversal of another tenant sale as 404', async () => {
    const created = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'rev-foreign-01',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    const res = await request(app).post(`/api/v1/pos/sales/${created.body.data.id}/reverse`).set(auth('user-prov-2')).send({});
    expect(res.status).toBe(404);
  });

  it('rejects SKU clashes on update and empty patches', async () => {
    const a = seedItem({ providerId: 'prov-1', sku: 'SKU-A' });
    seedItem({ providerId: 'prov-1', sku: 'SKU-B' });
    const clash = await request(app).patch(`/api/v1/pos/inventory/${a.id}`).set(auth('user-prov-1')).send({ sku: 'SKU-B' });
    expect(clash.status).toBe(422);
    expect(clash.body.error.code).toBe('SKU_IN_USE');
    const empty = await request(app).patch(`/api/v1/pos/inventory/${a.id}`).set(auth('user-prov-1')).send({});
    expect(empty.status).toBe(422);
  });

  it('filters inventory by search and active flag', async () => {
    seedItem({ providerId: 'prov-1', name: 'Argan Oil', isActive: true });
    seedItem({ providerId: 'prov-1', name: 'Old Comb', isActive: false });
    const search = await request(app).get('/api/v1/pos/inventory?search=Argan').set(auth('user-prov-1'));
    expect(search.body.data.some((i: any) => i.name === 'Argan Oil')).toBe(true);
    const active = await request(app).get('/api/v1/pos/inventory?isActive=false').set(auth('user-prov-1'));
    expect(active.body.data.every((i: any) => i.isActive === false)).toBe(true);
  });

  it('persists sale notes and exposes movement pagination meta', async () => {
    const created = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      note: 'Walk-in regular',
      idempotencyKey: 'note-sale-0001',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(created.body.data.note).toBe('Walk-in regular');
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 3 });
    await request(app).post(`/api/v1/pos/inventory/${item.id}/receive`).set(auth('user-prov-1')).send({ quantity: 1 });
    const movs = await request(app).get(`/api/v1/pos/inventory/${item.id}/movements?page=1&perPage=1`).set(auth('user-prov-1'));
    expect(movs.body.meta).toMatchObject({ page: 1, perPage: 1, total: 1 });
  });

  it('reversal keeps historical line snapshots and sale audit chain', async () => {
    const item = seedItem({ providerId: 'prov-1', sellingPrice: 60, quantityOnHand: 4 });
    const created = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'hist-rev-00001',
      lines: [{ lineType: 'PRODUCT', inventoryItemId: item.id, quantity: 1 }],
    });
    await request(app).patch(`/api/v1/pos/inventory/${item.id}`).set(auth('user-prov-1')).send({ sellingPrice: 500, name: 'Renamed' });
    const rev = await request(app).post(`/api/v1/pos/sales/${created.body.data.id}/reverse`).set(auth('user-prov-1')).send({ reason: 'return' });
    expect(rev.body.data.lines[0]).toMatchObject({ unitPrice: 60 });
    expect(rev.body.data.reversalReason).toBe('return');
    expect(auditActions()).toEqual(expect.arrayContaining(['POS_SALE_CREATED', 'POS_SALE_REVERSED']));
  });

  it('sale audit records the session actor, never a client id', async () => {
    await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      idempotencyKey: 'actor-check-01',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    const entry = audits.find((a) => a.action === 'POS_SALE_CREATED');
    expect(entry.actorUserId).toBe('user-prov-1');
    expect(JSON.stringify(entry)).not.toContain('prov-2');
  });

  it('inactive provider cannot transact', async () => {
    PROFILES['prov-1'].status = 'SUSPENDED';
    const r1 = await request(app).post('/api/v1/pos/inventory').set(auth('user-prov-1')).send({ name: 'X', sellingPrice: 5 });
    expect(r1.status).toBe(403);
    const r2 = await request(app).post('/api/v1/pos/sales').set(auth('user-prov-1')).send({
      paymentMethod: 'cash',
      lines: [{ lineType: 'SERVICE', serviceId: 'svc-1', quantity: 1 }],
    });
    expect(r2.status).toBe(403);
  });

  it('adjustment reasons and receive reasons are stored on movements', async () => {
    const item = seedItem({ providerId: 'prov-1', quantityOnHand: 5 });
    await request(app).post(`/api/v1/pos/inventory/${item.id}/adjust`).set(auth('user-prov-1')).send({ delta: -2, reason: 'Damaged in transit' });
    expect(movements[0].reason).toBe('Damaged in transit');
    expect(movements[0].referenceType).toBe('MANUAL');
  });
});

// ══════════════════════════════════════════════════════════════════
// FRONTEND CONTRACTS + WEB/MOBILE PARITY
// ══════════════════════════════════════════════════════════════════
describe('Slice 14 — frontend contracts and parity', () => {
  const webPos = require('../../apps/web/src/app/features/provider-pos/pos.utils');
  const mobilePos = require('../../apps/mobile/src/app/features/provider-pos/pos.utils');
  const webInv = require('../../apps/web/src/app/features/provider-inventory/inventory.utils');
  const mobileInv = require('../../apps/mobile/src/app/features/provider-inventory/inventory.utils');

  it('web POS utils: estimates, validation and offline gating', () => {
    expect(webPos.estimateLineTotal({ estimateUnitPrice: 49.99, quantity: 3 })).toBe(149.97);
    expect(webPos.estimateSaleTotal([
      { estimateUnitPrice: 200, quantity: 1 },
      { estimateUnitPrice: 50, quantity: 2 },
    ])).toBe(300);
    expect(webPos.validateSale([], 'cash')).toMatch(/at least one line/);
    expect(webPos.validateSale([{ lineType: 'SERVICE', refId: 's', name: 'x', estimateUnitPrice: 1, quantity: 1 }], 'card')).toMatch(/payment method/);
    expect(webPos.validateBuilderLine({ lineType: 'PRODUCT', refId: 'p', name: 'x', estimateUnitPrice: 5, quantity: 9, available: 4 })).toMatch(/in stock/);
    expect(webPos.validateSale([{ lineType: 'SERVICE', refId: 's', name: 'x', estimateUnitPrice: 1, quantity: 1 }], 'cash')).toBeNull();
    expect(webPos.requireOnline(false).ok).toBe(false);
    expect(webPos.requireOnline(false).message).toMatch(/NOT recorded/);
    expect(webPos.requireOnline(true).ok).toBe(true);
    expect(webPos.priceLabel(150)).toBe('R150.00');
    expect(webPos.statusLabel('REVERSED')).toBe('Reversed');
  });

  it('web POS utils: server-error mapping never leaks internals', () => {
    expect(webPos.saleErrorMessage({ error: { error: { code: 'INSUFFICIENT_STOCK' } } })).toMatch(/stock/);
    expect(webPos.saleErrorMessage({ error: { error: { code: 'CASH_CAP_EXCEEDED' } } })).toMatch(/cap/);
    expect(webPos.saleErrorMessage({ error: { error: { code: 'CASH_NOT_ACCEPTED' } } })).toMatch(/not accepted/);
    expect(webPos.saleErrorMessage({})).not.toMatch(/stack|SELECT/i);
  });

  it('mobile POS utils match web behaviour', () => {
    const line = { lineType: 'PRODUCT', refId: 'p', name: 'x', estimateUnitPrice: 25, quantity: 4, available: 10 };
    expect(mobilePos.estimateLineTotal(line)).toBe(webPos.estimateLineTotal(line));
    expect(mobilePos.validateSale([], 'cash')).toBe(webPos.validateSale([], 'cash'));
    expect(mobilePos.requireOnline(false)).toEqual(webPos.requireOnline(false));
    expect(mobilePos.priceLabel(99.5)).toBe(webPos.priceLabel(99.5));
    expect(mobilePos.saleErrorMessage({ error: { error: { code: 'SALE_NOT_REVERSIBLE' } } })).toBe(
      webPos.saleErrorMessage({ error: { error: { code: 'SALE_NOT_REVERSIBLE' } } }),
    );
  });

  it('web inventory utils: status, validation, movements and gating', () => {
    expect(webInv.stockStatus({ quantityOnHand: 0, lowStockThreshold: 3 })).toBe('OUT');
    expect(webInv.stockStatus({ quantityOnHand: 2, lowStockThreshold: 3 })).toBe('LOW');
    expect(webInv.stockStatus({ quantityOnHand: 9, lowStockThreshold: 3 })).toBe('OK');
    expect(webInv.stockLabel('LOW')).toBe('Low stock');
    expect(webInv.validateItemInput({ name: '', sellingPrice: 10 })).toMatch(/name/);
    expect(webInv.validateItemInput({ name: 'Gel', sellingPrice: -1 })).toMatch(/Selling price/);
    expect(webInv.validateItemInput({ name: 'Gel', sellingPrice: 10, quantityOnHand: 1.5 })).toMatch(/whole number/);
    expect(webInv.validateItemInput({ name: 'Gel', sellingPrice: 10 })).toBeNull();
    expect(webInv.validateStockDelta(0, 'adjust')).toMatch(/zero/);
    expect(webInv.validateStockDelta(0, 'receive')).toMatch(/at least 1/);
    expect(webInv.validateStockDelta(2.5, 'receive')).toMatch(/whole number/);
    expect(webInv.requireOnline(false).message).toMatch(/NOT changed/);
    expect(webInv.movementLabel('SALE')).toBe('Sale');
    expect(webInv.inventoryErrorMessage({ error: { error: { code: 'NEGATIVE_STOCK' } } })).toMatch(/below zero/);
    expect(webInv.inventoryErrorMessage({ error: { error: { code: 'SKU_IN_USE' } } })).toMatch(/SKU/);
  });

  it('mobile inventory utils match web behaviour', () => {
    expect(mobileInv.stockStatus({ quantityOnHand: 0, lowStockThreshold: 0 })).toBe(webInv.stockStatus({ quantityOnHand: 0, lowStockThreshold: 0 }));
    expect(mobileInv.movementLabel('RETURN')).toBe(webInv.movementLabel('RETURN'));
    expect(mobileInv.requireOnline(false)).toEqual(webInv.requireOnline(false));
    expect(mobileInv.validateItemInput({ name: '', sellingPrice: 1 })).toBe(webInv.validateItemInput({ name: '', sellingPrice: 1 }));
  });

  it('web + mobile POS services hit the same API with idempotency headers', () => {
    const { PosApiService: WebSvc } = require('../../apps/web/src/app/core/services/pos.service');
    const { PosApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/pos.service');
    for (const Svc of [WebSvc, MobileSvc]) {
      const calls: any[] = [];
      const http = {
        get: (url: string, opts?: any) => {
          calls.push(['GET', url, opts]);
          return of({ success: true, data: [] });
        },
        post: (url: string, body?: any, opts?: any) => {
          calls.push(['POST', url, body, opts]);
          return of({ success: true, data: {} });
        },
      };
      const svc = new Svc(http as any);
      let seen: any = null;
      svc.createSale({ paymentMethod: 'cash', idempotencyKey: 'k-12345678', lines: [{ lineType: 'SERVICE', serviceId: 's', quantity: 1 }] }).subscribe((r: any) => (seen = r));
      expect(seen.success).toBe(true);
      const [, url, body, opts] = calls[0];
      expect(url).toBe('/api/v1/pos/sales');
      expect(body.idempotencyKey).toBe('k-12345678');
      expect(body).not.toHaveProperty('providerId');
      expect(opts.headers['Idempotency-Key']).toBe('k-12345678');
      svc.listSales({ paymentMethod: 'cash' }).subscribe();
      expect(calls[1][0]).toBe('GET');
      expect(calls[1][1]).toBe('/api/v1/pos/sales');
      expect(calls[1][2].params.get('paymentMethod')).toBe('cash');
      svc.getSale('sale-1').subscribe();
      expect(calls[2][1]).toBe('/api/v1/pos/sales/sale-1');
      svc.reverseSale('sale-1', 'return').subscribe();
      expect(calls[3][1]).toBe('/api/v1/pos/sales/sale-1/reverse');
      expect(calls[3][2]).toEqual({ reason: 'return' });
    }
  });

  it('web + mobile inventory services hit the same API without ownership fields', () => {
    const { InventoryApiService: WebSvc } = require('../../apps/web/src/app/core/services/inventory.service');
    const { InventoryApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/inventory.service');
    for (const Svc of [WebSvc, MobileSvc]) {
      const calls: any[] = [];
      const http = {
        get: (url: string, opts?: any) => {
          calls.push(['GET', url, opts]);
          return of({ success: true, data: [] });
        },
        post: (url: string, body?: any) => {
          calls.push(['POST', url, body]);
          return of({ success: true, data: {} });
        },
        patch: (url: string, body?: any) => {
          calls.push(['PATCH', url, body]);
          return of({ success: true, data: {} });
        },
      };
      const svc = new Svc(http as any);
      svc.listItems({ lowStock: true }).subscribe();
      expect(calls[0][1]).toBe('/api/v1/pos/inventory');
      expect(calls[0][2].params.get('lowStock')).toBe('true');
      svc.receive('item-9', 4).subscribe();
      expect(calls[1]).toEqual(['POST', '/api/v1/pos/inventory/item-9/receive', { quantity: 4, reason: null }]);
      svc.adjust('item-9', -2).subscribe();
      expect(calls[2][1]).toBe('/api/v1/pos/inventory/item-9/adjust');
      svc.movements('item-9').subscribe();
      expect(calls[3][1]).toBe('/api/v1/pos/inventory/item-9/movements');
      svc.deactivate('item-9').subscribe();
      expect(calls[4][1]).toBe('/api/v1/pos/inventory/item-9/deactivate');
    }
  });

  it('web + mobile POS screens queue sale REQUESTS offline (never claimed) and keep reversals online-only', () => {
    const read = (p: string) => fs.readFileSync(path.join('/Users/balavan/Desktop/Work/Waasha', p), 'utf8');
    const web = read('apps/web/src/app/features/provider-pos/pos.component.ts');
    const mobile = read('apps/mobile/src/app/features/provider-pos/pos.page.ts');
    for (const src of [web, mobile]) {
      expect(src).toMatch(/requireOnline/);
      // Slice 18: sale creation queues as an idempotent REQUEST with explicit
      // not-recorded wording — never claimed as a completed sale.
      expect(src).toMatch(/enqueueAs\('pos\.sale\.create'/);
      expect(src).toMatch(/NOT recorded yet/);
      expect(src).toMatch(/not deducted until the server confirms/i);
      // Reversals stay online-only; a sale is never a booking.
      expect(src).toMatch(/reverse\(\)/);
      expect(src).toMatch(/not a booking/i);
    }
    // Idempotency lives in the API services (one key per sale, header + body).
    for (const svc of [
      read('apps/web/src/app/core/services/pos.service.ts'),
      read('apps/mobile/src/app/core/services/pos.service.ts'),
    ]) {
      expect(svc).toMatch(/Idempotency-Key/);
    }
    const webRoutes = read('apps/web/src/app/app.routes.ts');
    const mobileRoutes = read('apps/mobile/src/app/app.routes.ts');
    for (const r of [webRoutes, mobileRoutes]) {
      expect(r).toMatch(/provider\/pos/);
      expect(r).toMatch(/provider\/pos\/sales\/:id/);
      expect(r).toMatch(/provider\/inventory/);
      expect(r).toMatch(/provider\/inventory\/:id/);
    }
    const webInvSrc = read('apps/web/src/app/features/provider-inventory/inventory.component.ts');
    const mobileInvSrc = read('apps/mobile/src/app/features/provider-inventory/inventory.page.ts');
    for (const src of [webInvSrc, mobileInvSrc]) {
      expect(src).toMatch(/requireOnline/);
      expect(src).toMatch(/authoritative/);
    }
  });

  it('no mobile-only POS business logic exists', () => {
    const read = (p: string) => fs.readFileSync(path.join('/Users/balavan/Desktop/Work/Waasha', p), 'utf8');
    const mobileSvc = read('apps/mobile/src/app/core/services/pos.service.ts');
    const webSvc = read('apps/web/src/app/core/services/pos.service.ts');
    expect(mobileSvc).toContain('/api/v1/pos/sales');
    expect(webSvc).toContain('/api/v1/pos/sales');
    // Mobile must not compute authoritative totals or commissions.
    expect(mobileSvc).not.toMatch(/commission/i);
  });
});

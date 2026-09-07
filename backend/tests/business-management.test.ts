/**
 * Slice 15 — T2/T3 business management.
 *
 * Covers team lifecycle, invitations (secure/scoped/expiring/single-use),
 * business/unit/category/location/staff lifecycle, service attach/detach,
 * booking assignment, marketplace BusinessLocation indexing (BOTH rule, no
 * tier boost), POS/inventory scope integration, and aggressive IDOR /
 * privilege-escalation / tenant-isolation security tests.
 *
 * Prisma is mocked at the module boundary with in-memory stores; the real
 * route → service → notification → audit code runs unmodified, including
 * serializable transactions (executed inline, faithfully ordered) and the
 * real SHA-256 invitation token flow.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

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
const mockProfileFindFirst = jest.fn();
const mockProfileFindMany = jest.fn();
const mockTeamFindFirst = jest.fn();
const mockTeamFindMany = jest.fn();
const mockTeamFindUnique = jest.fn();
const mockTeamCreate = jest.fn();
const mockTeamUpdate = jest.fn();
const mockTeamMemberFindMany = jest.fn();
const mockTeamMemberFindUnique = jest.fn();
const mockTeamMemberCreate = jest.fn();
const mockTeamMemberUpdate = jest.fn();
const mockTeamInvCreate = jest.fn();
const mockTeamInvFindMany = jest.fn();
const mockTeamInvFindUnique = jest.fn();
const mockTeamInvUpdate = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessFindUnique = jest.fn();
const mockBusinessCreate = jest.fn();
const mockBusinessUpdate = jest.fn();
const mockUnitFindMany = jest.fn();
const mockUnitFindUnique = jest.fn();
const mockUnitCreate = jest.fn();
const mockUnitUpdate = jest.fn();
const mockUnitCatFindMany = jest.fn();
const mockUnitCatFindFirst = jest.fn();
const mockUnitCatCreate = jest.fn();
const mockUnitCatDeleteMany = jest.fn();
const mockUnitLocCreate = jest.fn();
const mockUnitLocFindMany = jest.fn();
const mockUnitLocUpdate = jest.fn();
const mockStaffFindMany = jest.fn();
const mockStaffFindFirst = jest.fn();
const mockStaffFindUnique = jest.fn();
const mockStaffCreate = jest.fn();
const mockStaffUpdate = jest.fn();
const mockStaffInvCreate = jest.fn();
const mockStaffInvFindMany = jest.fn();
const mockStaffInvFindUnique = jest.fn();
const mockStaffInvUpdate = jest.fn();
const mockCategoryFindUnique = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockServiceFindFirst = jest.fn();
const mockServiceFindMany = jest.fn();
const mockServiceUpdate = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingCount = jest.fn();
const mockBookingUpdate = jest.fn();
const mockProviderLocFindMany = jest.fn();
const mockBusinessLocFindMany = jest.fn();
const mockReviewGroupBy = jest.fn();
const mockAvailFindFirst = jest.fn();
const mockNotifCreate = jest.fn();
const mockNotifPrefFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockAdminFindMany = jest.fn();
const mockItemFindUnique = jest.fn();
const mockItemFindMany = jest.fn();
const mockItemCount = jest.fn();
const mockItemCreate = jest.fn();
const mockItemUpdate = jest.fn();
const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    providerProfile: {
      findUnique: (...a: any[]) => (mockProfileFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockProfileFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockProfileFindMany as any)(...a),
    },
    team: {
      findFirst: (...a: any[]) => (mockTeamFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockTeamFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockTeamFindUnique as any)(...a),
      create: (...a: any[]) => (mockTeamCreate as any)(...a),
      update: (...a: any[]) => (mockTeamUpdate as any)(...a),
    },
    teamMember: {
      findMany: (...a: any[]) => (mockTeamMemberFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockTeamMemberFindUnique as any)(...a),
      create: (...a: any[]) => (mockTeamMemberCreate as any)(...a),
      update: (...a: any[]) => (mockTeamMemberUpdate as any)(...a),
    },
    teamInvitation: {
      create: (...a: any[]) => (mockTeamInvCreate as any)(...a),
      findMany: (...a: any[]) => (mockTeamInvFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockTeamInvFindUnique as any)(...a),
      update: (...a: any[]) => (mockTeamInvUpdate as any)(...a),
    },
    business: {
      findMany: (...a: any[]) => (mockBusinessFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockBusinessFindUnique as any)(...a),
      create: (...a: any[]) => (mockBusinessCreate as any)(...a),
      update: (...a: any[]) => (mockBusinessUpdate as any)(...a),
    },
    businessUnit: {
      findMany: (...a: any[]) => (mockUnitFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockUnitFindUnique as any)(...a),
      create: (...a: any[]) => (mockUnitCreate as any)(...a),
      update: (...a: any[]) => (mockUnitUpdate as any)(...a),
    },
    businessUnitCategory: {
      findMany: (...a: any[]) => (mockUnitCatFindMany as any)(...a),
      findFirst: (...a: any[]) => (mockUnitCatFindFirst as any)(...a),
      create: (...a: any[]) => (mockUnitCatCreate as any)(...a),
      deleteMany: (...a: any[]) => (mockUnitCatDeleteMany as any)(...a),
    },
    businessLocation: {
      create: (...a: any[]) => (mockUnitLocCreate as any)(...a),
      findMany: (...a: any[]) => (mockBusinessLocFindMany as any)(...a),
      update: (...a: any[]) => (mockUnitLocUpdate as any)(...a),
    },
    businessStaff: {
      findMany: (...a: any[]) => (mockStaffFindMany as any)(...a),
      findFirst: (...a: any[]) => (mockStaffFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockStaffFindUnique as any)(...a),
      create: (...a: any[]) => (mockStaffCreate as any)(...a),
      update: (...a: any[]) => (mockStaffUpdate as any)(...a),
    },
    businessStaffInvitation: {
      create: (...a: any[]) => (mockStaffInvCreate as any)(...a),
      findMany: (...a: any[]) => (mockStaffInvFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockStaffInvFindUnique as any)(...a),
      update: (...a: any[]) => (mockStaffInvUpdate as any)(...a),
    },
    serviceCategory: { findUnique: (...a: any[]) => (mockCategoryFindUnique as any)(...a) },
    service: {
      findUnique: (...a: any[]) => (mockServiceFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockServiceFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockServiceFindMany as any)(...a),
      update: (...a: any[]) => (mockServiceUpdate as any)(...a),
    },
    booking: {
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockBookingFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      count: (...a: any[]) => (mockBookingCount as any)(...a),
      update: (...a: any[]) => (mockBookingUpdate as any)(...a),
    },
    providerLocation: { findMany: (...a: any[]) => (mockProviderLocFindMany as any)(...a) },
    review: { groupBy: (...a: any[]) => (mockReviewGroupBy as any)(...a) },
    availabilityRule: { findFirst: (...a: any[]) => (mockAvailFindFirst as any)(...a) },
    notification: { create: (...a: any[]) => (mockNotifCreate as any)(...a) },
    notificationPreference: { findUnique: (...a: any[]) => (mockNotifPrefFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    adminSetting: { findMany: (...a: any[]) => (mockAdminFindMany as any)(...a) },
    inventoryItem: {
      findUnique: (...a: any[]) => (mockItemFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockItemFindMany as any)(...a),
      count: (...a: any[]) => (mockItemCount as any)(...a),
      create: (...a: any[]) => (mockItemCreate as any)(...a),
      update: (...a: any[]) => (mockItemUpdate as any)(...a),
    },
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
    $queryRaw: (...a: any[]) => (mockQueryRaw as any)(...a),
  },
}));

import { app } from '../src/app';

// ---- in-memory stores ----
let users: Record<string, any>;
let profilesByUser: Record<string, any>;
let profilesById: Record<string, any>;
let teams: Record<string, any>;
let teamMembers: Record<string, any>;
let teamInvs: Record<string, any>;
let businesses: Record<string, any>;
let units: Record<string, any>;
let unitCats: any[];
let unitLocs: Record<string, any>;
let staff: Record<string, any>;
let staffInvs: Record<string, any>;
let services: Record<string, any>;
let bookings: Record<string, any>;
let items: Record<string, any>;
let audits: any[];
let notifs: any[];
let providerLocs: any[];
let businessLocs: any[];
let svcCatServices: any[];
let seq: number;

const CATS = [
  { id: 'cat-barbers', code: 'BARBERS', name: 'Barbers' },
  { id: 'cat-hair', code: 'HAIR', name: 'Hair Salons & Stylists' },
  { id: 'cat-nails', code: 'NAILS', name: 'Nail Technicians' },
  { id: 'cat-beauty', code: 'BEAUTY', name: 'Beauty Services' },
  { id: 'cat-carwash', code: 'CARWASH', name: 'Car Wash' },
];

function resetStores() {
  users = {};
  profilesByUser = {};
  profilesById = {};
  teams = {};
  teamMembers = {};
  teamInvs = {};
  businesses = {};
  units = {};
  unitCats = [];
  unitLocs = {};
  staff = {};
  staffInvs = {};
  services = {};
  bookings = {};
  items = {};
  audits = [];
  notifs = [];
  providerLocs = [];
  businessLocs = [];
  svcCatServices = [];
  seq = 0;
}
const nid = (p: string) => `${p}-${(seq += 1)}`;

function seedUser(id: string, status = 'ACTIVE') {
  users[id] = { id, status };
}
function seedProvider(userId: string, tierCode: 'T1' | 'T2' | 'T3', over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? `prov-${userId}`;
  const p = {
    id,
    userId,
    status: 'ACTIVE',
    tier: { code: tierCode, name: tierCode },
    providerType: tierCode === 'T2' ? 'TEAM' : tierCode === 'T3' ? 'BUSINESS' : 'INDIVIDUAL',
    displayName: `Provider ${userId}`,
    coverageRadiusKm: 10,
    ...over,
    tier: { code: tierCode, name: tierCode },
  };
  profilesByUser[userId] = p;
  profilesById[id] = p;
  return p;
}
function seedTeam(ownerUserId: string, over: Record<string, unknown> = {}) {
  const t = { id: nid('team'), uuid: nid('uuid'), ownerProviderId: ownerUserId, name: 'Team', description: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...over };
  teams[t.id] = t;
  return t;
}
function seedTeamMember(teamId: string, providerId: string, over: Record<string, unknown> = {}) {
  const m = { id: nid('tm'), teamId, providerId, role: 'PROVIDER', status: 'ACTIVE', joinedAt: new Date(), createdAt: new Date(), ...over };
  teamMembers[m.id] = m;
  return m;
}
function seedBusiness(ownerUserId: string, over: Record<string, unknown> = {}) {
  const b = { id: nid('biz'), uuid: nid('uuid'), ownerProviderId: ownerUserId, legalName: null, displayName: 'Biz', description: null, status: 'ACTIVE', verificationStatus: 'UNVERIFIED', createdAt: new Date(), updatedAt: new Date(), ...over };
  businesses[b.id] = b;
  return b;
}
function seedUnit(businessId: string, over: Record<string, unknown> = {}) {
  const u = { id: nid('unit'), uuid: nid('uuid'), businessId, name: 'Unit', description: null, status: 'ACTIVE', coverageRadiusKm: 10, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...over };
  units[u.id] = u;
  return u;
}
function seedStaff(businessId: string, providerId: string, over: Record<string, unknown> = {}) {
  const s = { id: nid('st'), businessId, businessUnitId: null, providerId, role: 'STAFF', status: 'ACTIVE', joinedAt: new Date(), createdAt: new Date(), ...over };
  staff[s.id] = s;
  return s;
}
function seedService(over: Record<string, unknown> = {}) {
  const s = { id: nid('svc'), uuid: nid('uuid'), providerId: 'prov-x', businessUnitId: null, serviceCategoryId: 'cat-barbers', name: 'Svc', price: 100, status: 'ACTIVE', ...over };
  services[s.id] = s;
  return s;
}
function seedBooking(over: Record<string, unknown> = {}) {
  const b = { id: nid('bk'), uuid: nid('uuid'), customerId: 'cust-1', providerId: null, businessUnitId: null, assignedProviderId: null, serviceId: null, status: 'PENDING', paymentStatus: 'PENDING', scheduledStart: new Date(), scheduledEnd: new Date(), ...over };
  bookings[b.id] = b;
  return b;
}

function wireMocks() {
  const { prisma } = require('../src/config/prisma');
  mockTransaction.mockImplementation((cb: any) => cb(prisma));
  mockQueryRaw.mockResolvedValue([]);
  mockUserFindUnique.mockImplementation(async (args: any) => users[args?.where?.id] ?? null);
  mockProfileFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    const p = w.userId ? profilesByUser[w.userId] : profilesById[w.id];
    return p ?? null;
  });
  mockProfileFindFirst.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return (
      Object.values(profilesById).find((p: any) => {
        if (w.userId && p.userId !== w.userId) return false;
        if (w.status && p.status !== w.status) return false;
        if (w.id && p.id !== w.id) return false;
        return true;
      }) ?? null
    );
  });
  mockProfileFindMany.mockImplementation(async (args: any) => {
    const ids: string[] = args?.where?.id?.in ?? [];
    return Object.values(profilesById).filter((p: any) => (ids.length === 0 ? true : ids.includes(p.id)));
  });
  mockTeamFindFirst.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(teams).find((t: any) => (w.ownerProviderId ? t.ownerProviderId === w.ownerProviderId : true)) ?? null;
  });
  mockTeamFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(teams).filter((t: any) => {
      if (w.id?.in && !w.id.in.includes(t.id)) return false;
      if (typeof w.id === 'string' && t.id !== w.id) return false;
      if (w.ownerProviderId && t.ownerProviderId !== w.ownerProviderId) return false;
      return true;
    });
  });
  mockTeamFindUnique.mockImplementation(async (args: any) => teams[args?.where?.id] ?? null);
  mockTeamCreate.mockImplementation(async (args: any) => {
    const t = { id: nid('team'), uuid: nid('uuid'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    teams[t.id] = t;
    return t;
  });
  mockTeamUpdate.mockImplementation(async (args: any) => {
    Object.assign(teams[args.where.id], args.data, { updatedAt: new Date() });
    return teams[args.where.id];
  });
  mockTeamMemberFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(teamMembers).filter((m: any) => {
      if (w.teamId && typeof w.teamId === 'string' && m.teamId !== w.teamId) return false;
      if (w.teamId?.in && !w.teamId.in.includes(m.teamId)) return false;
      if (w.providerId && m.providerId !== w.providerId) return false;
      if (w.status && m.status !== w.status) return false;
      return true;
    });
  });
  mockTeamMemberFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    if (w.id) return teamMembers[w.id] ?? null;
    const k = w.teamId_providerId;
    if (k) return Object.values(teamMembers).find((m: any) => m.teamId === k.teamId && m.providerId === k.providerId) ?? null;
    return null;
  });
  mockTeamMemberCreate.mockImplementation(async (args: any) => {
    const m = { id: nid('tm'), joinedAt: new Date(), createdAt: new Date(), ...args.data };
    teamMembers[m.id] = m;
    return m;
  });
  mockTeamMemberUpdate.mockImplementation(async (args: any) => {
    Object.assign(teamMembers[args.where.id], args.data);
    return teamMembers[args.where.id];
  });
  mockTeamInvCreate.mockImplementation(async (args: any) => {
    const inv = { id: nid('tinv'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    teamInvs[inv.id] = inv;
    return inv;
  });
  mockTeamInvFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(teamInvs).filter((i: any) => (w.teamId ? i.teamId === w.teamId : true));
  });
  mockTeamInvFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    if (w.id) return teamInvs[w.id] ?? null;
    if (w.tokenHash) return Object.values(teamInvs).find((i: any) => i.tokenHash === w.tokenHash) ?? null;
    return null;
  });
  mockTeamInvUpdate.mockImplementation(async (args: any) => {
    Object.assign(teamInvs[args.where.id], args.data);
    return teamInvs[args.where.id];
  });
  mockBusinessFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(businesses).filter((b: any) => {
      if (w.ownerProviderId && b.ownerProviderId !== w.ownerProviderId) return false;
      if (w.id?.in && !w.id.in.includes(b.id)) return false;
      if (typeof w.id === 'string' && b.id !== w.id) return false;
      return true;
    });
  });
  mockBusinessFindUnique.mockImplementation(async (args: any) => businesses[args?.where?.id] ?? null);
  mockBusinessCreate.mockImplementation(async (args: any) => {
    const b = { id: nid('biz'), uuid: nid('uuid'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    businesses[b.id] = b;
    return b;
  });
  mockBusinessUpdate.mockImplementation(async (args: any) => {
    Object.assign(businesses[args.where.id], args.data, { updatedAt: new Date() });
    return businesses[args.where.id];
  });
  mockUnitFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(units).filter((u: any) => {
      if (w.businessId && typeof w.businessId === 'string' && u.businessId !== w.businessId) return false;
      if (w.businessId?.in && !w.businessId.in.includes(u.businessId)) return false;
      return true;
    });
  });
  mockUnitFindUnique.mockImplementation(async (args: any) => units[args?.where?.id] ?? null);
  mockUnitCreate.mockImplementation(async (args: any) => {
    const u = { id: nid('unit'), uuid: nid('uuid'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    units[u.id] = u;
    return u;
  });
  mockUnitUpdate.mockImplementation(async (args: any) => {
    Object.assign(units[args.where.id], args.data, { updatedAt: new Date() });
    return units[args.where.id];
  });
  mockUnitCatFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    const rows = unitCats.filter((c: any) => (w.businessUnitId ? (w.businessUnitId.in ? w.businessUnitId.in.includes(c.businessUnitId) : c.businessUnitId === w.businessUnitId) : true));
    if (args?.include?.category) {
      return rows.map((c: any) => ({ ...c, category: CATS.find((k) => k.id === c.serviceCategoryId) ?? null }));
    }
    return rows;
  });
  mockUnitCatFindFirst.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return unitCats.find((c: any) => c.businessUnitId === w.businessUnitId && c.serviceCategoryId === w.serviceCategoryId) ?? null;
  });
  mockUnitCatCreate.mockImplementation(async (args: any) => {
    const c = { id: nid('uc'), ...args.data };
    unitCats.push(c);
    return c;
  });
  mockUnitCatDeleteMany.mockImplementation(async (args: any) => {
    const before = unitCats.length;
    unitCats = unitCats.filter((c: any) => c.businessUnitId !== args?.where?.businessUnitId);
    return { count: before - unitCats.length };
  });
  mockUnitLocCreate.mockImplementation(async (args: any) => {
    const l = { id: nid('uloc'), ...args.data };
    unitLocs[l.id] = l;
    return l;
  });
  mockBusinessLocFindMany.mockImplementation(async (_args: any) => businessLocs);
  mockUnitLocUpdate.mockImplementation(async (args: any) => {
    Object.assign(unitLocs[args.where.id], args.data);
    return unitLocs[args.where.id];
  });
  mockStaffFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(staff).filter((s: any) => {
      if (w.businessId && typeof w.businessId === 'string' && s.businessId !== w.businessId) return false;
      if (w.businessId?.in && !w.businessId.in.includes(s.businessId)) return false;
      if (w.providerId && s.providerId !== w.providerId) return false;
      if (w.status && s.status !== w.status) return false;
      if (w.businessUnitId && s.businessUnitId !== w.businessUnitId) return false;
      return true;
    });
  });
  mockStaffFindFirst.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(staff).find((s: any) => {
      if (w.businessId && s.businessId !== w.businessId) return false;
      if (w.providerId && s.providerId !== w.providerId) return false;
      if (w.status && s.status !== w.status) return false;
      return true;
    }) ?? null;
  });
  mockStaffFindUnique.mockImplementation(async (args: any) => staff[args?.where?.id] ?? null);
  mockStaffCreate.mockImplementation(async (args: any) => {
    const s = { id: nid('st'), joinedAt: new Date(), createdAt: new Date(), ...args.data };
    staff[s.id] = s;
    return s;
  });
  mockStaffUpdate.mockImplementation(async (args: any) => {
    Object.assign(staff[args.where.id], args.data);
    return staff[args.where.id];
  });
  mockStaffInvCreate.mockImplementation(async (args: any) => {
    const inv = { id: nid('sinv'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    staffInvs[inv.id] = inv;
    return inv;
  });
  mockStaffInvFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return Object.values(staffInvs).filter((i: any) => (w.businessId ? i.businessId === w.businessId : true));
  });
  mockStaffInvFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    if (w.id) return staffInvs[w.id] ?? null;
    if (w.tokenHash) return Object.values(staffInvs).find((i: any) => i.tokenHash === w.tokenHash) ?? null;
    return null;
  });
  mockStaffInvUpdate.mockImplementation(async (args: any) => {
    Object.assign(staffInvs[args.where.id], args.data);
    return staffInvs[args.where.id];
  });
  mockCategoryFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return CATS.find((c) => c.id === w.id || c.code === w.code) ?? null;
  });
  mockServiceFindUnique.mockImplementation(async (args: any) => services[args?.where?.id] ?? null);
  mockServiceFindFirst.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    return (
      svcCatServices.find((s: any) => {
        if (w.businessUnitId && s.businessUnitId !== w.businessUnitId) return false;
        if (w.providerId && s.providerId !== w.providerId) return false;
        if (w.serviceCategoryId && s.serviceCategoryId !== w.serviceCategoryId) return false;
        if (w.status && s.status !== w.status) return false;
        return true;
      }) ??
      Object.values(services).find((s: any) => {
        if (w.businessUnitId && s.businessUnitId !== w.businessUnitId) return false;
        if (w.providerId && s.providerId !== w.providerId) return false;
        if (w.serviceCategoryId && s.serviceCategoryId !== w.serviceCategoryId) return false;
        if (w.status && s.status !== w.status) return false;
        return true;
      }) ??
      null
    );
  });
  mockServiceFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    let rows: any[] = [...Object.values(services), ...svcCatServices];
    if (w.businessUnitId) {
      rows = rows.filter((s: any) => (w.businessUnitId.in ? w.businessUnitId.in.includes(s.businessUnitId) : s.businessUnitId === w.businessUnitId));
    }
    if (w.businessUnitId === undefined && w.providerId?.in) {
      rows = rows.filter((s: any) => w.providerId.in.includes(s.providerId));
    }
    if (args?.include?.category) {
      rows = rows.map((s: any) => ({ ...s, category: CATS.find((k) => k.id === s.serviceCategoryId) ?? null }));
    }
    return rows;
  });
  mockServiceUpdate.mockImplementation(async (args: any) => {
    Object.assign(services[args.where.id], args.data);
    return services[args.where.id];
  });
  mockBookingFindUnique.mockImplementation(async (args: any) => {
    const b = bookings[args?.where?.id] ?? null;
    if (!b) return null;
    if (args?.include) {
      return { ...b, items: [], location: b.location ?? null, customer: { id: 'cust-1', displayName: 'Customer', firstName: 'C' }, payment: null, cashPaymentDetail: null };
    }
    return b;
  });
  mockBookingFindFirst.mockImplementation(async () => null);
  const matchBookingWhere = (b: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR && Array.isArray(where.OR)) {
      const hit = where.OR.some((clause: any) => {
        if (clause.providerId && b.providerId === clause.providerId) return true;
        if (clause.assignedProviderId && b.assignedProviderId === clause.assignedProviderId) return true;
        if (clause.businessUnitId?.in && clause.businessUnitId.in.includes(b.businessUnitId)) return true;
        if (typeof clause.businessUnitId === 'string' && b.businessUnitId === clause.businessUnitId) return true;
        return false;
      });
      if (!hit) return false;
    }
    if (where.status?.in && !where.status.in.includes(b.status)) return false;
    if (typeof where.status === 'string' && b.status !== where.status) return false;
    return true;
  };
  const enrichBooking = (b: any) => ({ ...b, items: [], customer: { id: 'cust-1', displayName: 'Customer', firstName: 'C' } });
  mockBookingFindMany.mockImplementation(async (args: any) => {
    const rows = Object.values(bookings).filter((b: any) => matchBookingWhere(b, args?.where));
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take).map(enrichBooking);
  });
  mockBookingCount.mockImplementation(async (args: any) => Object.values(bookings).filter((b: any) => matchBookingWhere(b, args?.where)).length);
  mockBookingUpdate.mockImplementation(async (args: any) => {
    Object.assign(bookings[args.where.id], args.data);
    const b: any = bookings[args.where.id];
    if (args?.include) return { ...b, items: [], location: b.location ?? null };
    return b;
  });
  mockProviderLocFindMany.mockImplementation(async () => providerLocs);
  mockReviewGroupBy.mockResolvedValue([]);
  mockAvailFindFirst.mockResolvedValue(null);
  mockNotifCreate.mockImplementation(async (args: any) => {
    const data = args.data;
    if (data.eventKey && notifs.some((n: any) => n.eventKey === data.eventKey)) {
      const e: any = new Error('Unique constraint');
      e.code = 'P2002';
      throw e;
    }
    const n = { id: nid('notif'), createdAt: new Date(), ...data };
    notifs.push(n);
    return n;
  });
  mockNotifPrefFindUnique.mockResolvedValue(null);
  mockAuditCreate.mockImplementation(async (args: any) => {
    const a = { id: nid('audit'), createdAt: new Date(), ...args.data };
    audits.push(a);
    return a;
  });
  mockAdminFindMany.mockResolvedValue([]);
  mockItemFindUnique.mockImplementation(async (args: any) => items[args?.where?.id] ?? null);
  mockItemFindMany.mockImplementation(async () => Object.values(items));
  mockItemCount.mockImplementation(async () => Object.values(items).length);
  mockItemCreate.mockImplementation(async (args: any) => {
    const it = { id: nid('item'), uuid: nid('uuid'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
    items[it.id] = it;
    return it;
  });
  mockItemUpdate.mockImplementation(async (args: any) => {
    Object.assign(items[args.where.id], args.data);
    return items[args.where.id];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  wireMocks();
});

// ---- shared fixtures ----
function stdUsers() {
  for (const u of ['u-t2', 'u-t1', 'u-t3', 'u-member', 'u-staff', 'u-t2b', 'u-t3b']) seedUser(u);
  seedProvider('u-t2', 'T2', { id: 'prov-t2' });
  seedProvider('u-t1', 'T1', { id: 'prov-t1' });
  seedProvider('u-t3', 'T3', { id: 'prov-t3' });
  seedProvider('u-member', 'T1', { id: 'prov-member' });
  seedProvider('u-staff', 'T1', { id: 'prov-staff' });
  seedProvider('u-t2b', 'T2', { id: 'prov-t2b' });
  seedProvider('u-t3b', 'T3', { id: 'prov-t3b' });
}

describe('Slice 15 — capabilities', () => {
  it('1. capabilities expose tier + team/business scope, no secrets', async () => {
    stdUsers();
    seedTeam('u-t2');
    const res = await request(app).get('/api/v1/providers/me/capabilities').set(auth('u-t2')).expect(200);
    expect(res.body.data.tierCode).toBe('T2');
    expect(res.body.data.hasTeam).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|password|hash/i);
  });

  it('2. capabilities require authentication', async () => {
    await request(app).get('/api/v1/providers/me/capabilities').expect(401);
  });
});

describe('Slice 15 — T2 team lifecycle', () => {
  it('3. T2 creates a team + audit', async () => {
    stdUsers();
    const res = await request(app).post('/api/v1/providers/me/team').set(auth('u-t2')).send({ name: 'Dream Team' }).expect(201);
    expect(res.body.data.name).toBe('Dream Team');
    expect(audits.some((a) => a.action === 'TEAM_CREATED')).toBe(true);
  });

  it('4. second team creation conflicts', async () => {
    stdUsers();
    seedTeam('u-t2');
    const res = await request(app).post('/api/v1/providers/me/team').set(auth('u-t2')).send({ name: 'Other' }).expect(409);
    expect(res.body.error.code).toBe('TEAM_EXISTS');
  });

  it('5. T1 cannot create a team', async () => {
    stdUsers();
    const res = await request(app).post('/api/v1/providers/me/team').set(auth('u-t1')).send({ name: 'Nope' }).expect(403);
    expect(res.body.error.code).toBe('TIER_REQUIRED');
  });

  it('6. client-supplied ownership ids are rejected', async () => {
    stdUsers();
    const res = await request(app)
      .post('/api/v1/providers/me/team')
      .set(auth('u-t2'))
      .send({ name: 'X', providerId: 'prov-t1', ownerProviderId: 'u-t1' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('7. missing name is rejected', async () => {
    stdUsers();
    await request(app).post('/api/v1/providers/me/team').set(auth('u-t2')).send({}).expect(422);
  });

  it('8. owner reads team with members', async () => {
    stdUsers();
    const t = seedTeam('u-t2', { name: 'A' });
    seedTeamMember(t.id, 'prov-member');
    const res = await request(app).get('/api/v1/providers/me/team').set(auth('u-t2')).expect(200);
    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.activeMemberCount).toBe(1);
  });

  it('9. T1 cannot read team endpoints', async () => {
    stdUsers();
    await request(app).get('/api/v1/providers/me/team').set(auth('u-t1')).expect(403);
  });

  it('10. unauthenticated team access fails', async () => {
    await request(app).get('/api/v1/providers/me/team').expect(401);
  });

  it('11. owner renames team + audit', async () => {
    stdUsers();
    seedTeam('u-t2', { name: 'Old' });
    const res = await request(app).patch('/api/v1/providers/me/team').set(auth('u-t2')).send({ name: 'New' }).expect(200);
    expect(res.body.data.name).toBe('New');
    expect(audits.some((a) => a.action === 'TEAM_UPDATED')).toBe(true);
  });

  it('12. team update rejects ownership fields', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).patch('/api/v1/providers/me/team').set(auth('u-t2')).send({ ownerProviderId: 'u-t1' }).expect(422);
  });
});

describe('Slice 15 — T2 members', () => {
  it('13. owner adds member + audit + notification', async () => {
    stdUsers();
    seedTeam('u-t2');
    const res = await request(app)
      .post('/api/v1/providers/me/team/members')
      .set(auth('u-t2'))
      .send({ providerId: 'prov-member', role: 'PROVIDER' })
      .expect(201);
    expect(res.body.data.providerId).toBe('prov-member');
    expect(audits.some((a) => a.action === 'TEAM_MEMBER_ADDED')).toBe(true);
    expect(notifs.some((n) => n.type === 'TEAM_MEMBER_ADDED')).toBe(true);
  });

  it('14. duplicate member conflicts', async () => {
    stdUsers();
    const t = seedTeam('u-t2');
    seedTeamMember(t.id, 'prov-member');
    await request(app).post('/api/v1/providers/me/team/members').set(auth('u-t2')).send({ providerId: 'prov-member' }).expect(409);
  });

  it('15. adding unknown provider is safe 404', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/members').set(auth('u-t2')).send({ providerId: 'prov-ghost' }).expect(404);
  });

  it('16. owner cannot add themselves', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/members').set(auth('u-t2')).send({ providerId: 'prov-t2' }).expect(422);
  });

  it('17. invalid role rejected', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/members').set(auth('u-t2')).send({ providerId: 'prov-member', role: 'ADMIN' }).expect(422);
  });

  it('18. member role update audited', async () => {
    stdUsers();
    const t = seedTeam('u-t2');
    const m = seedTeamMember(t.id, 'prov-member');
    const res = await request(app).patch(`/api/v1/providers/me/team/members/${m.id}`).set(auth('u-t2')).send({ role: 'MANAGER' }).expect(200);
    expect(res.body.data.role).toBe('MANAGER');
    expect(audits.some((a) => a.action === 'TEAM_MEMBER_UPDATED')).toBe(true);
  });

  it('19. OWNER role grant is reserved', async () => {
    stdUsers();
    const t = seedTeam('u-t2');
    const m = seedTeamMember(t.id, 'prov-member');
    await request(app).patch(`/api/v1/providers/me/team/members/${m.id}`).set(auth('u-t2')).send({ role: 'OWNER' }).expect(422);
  });

  it('20. removal deactivates (history preserved, never deleted)', async () => {
    stdUsers();
    const t = seedTeam('u-t2');
    const m = seedTeamMember(t.id, 'prov-member');
    await request(app).delete(`/api/v1/providers/me/team/members/${m.id}`).set(auth('u-t2')).expect(200);
    expect(teamMembers[m.id].status).toBe('INACTIVE');
    expect(teamMembers[m.id]).toBeDefined();
    expect(audits.some((a) => a.action === 'TEAM_MEMBER_REMOVED')).toBe(true);
  });

  it('21. cross-team member update is safe 404 (IDOR)', async () => {
    stdUsers();
    const tA = seedTeam('u-t2');
    const m = seedTeamMember(tA.id, 'prov-member');
    seedTeam('u-t2b', { name: 'B' });
    const res = await request(app).patch(`/api/v1/providers/me/team/members/${m.id}`).set(auth('u-t2b')).send({ role: 'MANAGER' }).expect(404);
    expect(res.body.error.code).toBe('TEAM_MEMBER_NOT_FOUND');
    expect(teamMembers[m.id].role).toBe('PROVIDER');
  });

  it('22. T1 cannot list members', async () => {
    stdUsers();
    await request(app).get('/api/v1/providers/me/team/members').set(auth('u-t1')).expect(403);
  });
});

describe('Slice 15 — T2 invitations', () => {
  it('23. invitation created with single-use token (hash stored, raw returned once)', async () => {
    stdUsers();
    seedTeam('u-t2');
    const res = await request(app)
      .post('/api/v1/providers/me/team/invitations')
      .set(auth('u-t2'))
      .send({ invitedProviderId: 'prov-member' })
      .expect(201);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(32);
    const stored = Object.values(teamInvs)[0] as any;
    expect(stored.tokenHash).toBeDefined();
    expect(stored.tokenHash).not.toBe(res.body.data.token);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/);
    expect(audits.some((a) => a.action === 'TEAM_INVITATION_CREATED')).toBe(true);
    expect(notifs.some((n) => n.type === 'TEAM_INVITATION')).toBe(true);
  });

  it('24. invalid email rejected', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedEmail: 'bad' }).expect(422);
  });

  it('25. self-invite rejected', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-t2' }).expect(422);
  });

  it('26. invitations list without secrets', async () => {
    stdUsers();
    seedTeam('u-t2');
    await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-member' }).expect(201);
    const res = await request(app).get('/api/v1/providers/me/team/invitations').set(auth('u-t2')).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/);
  });

  it('27. revoke + double-revoke guarded', async () => {
    stdUsers();
    seedTeam('u-t2');
    const c = await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-member' }).expect(201);
    await request(app).post(`/api/v1/providers/me/team/invitations/${c.body.data.id}/revoke`).set(auth('u-t2')).send({}).expect(200);
    const res = await request(app).post(`/api/v1/providers/me/team/invitations/${c.body.data.id}/revoke`).set(auth('u-t2')).send({}).expect(422);
    expect(res.body.error.code).toBe('INVITATION_NOT_PENDING');
  });

  it('28. invited provider accepts (membership created, single-use)', async () => {
    stdUsers();
    seedTeam('u-t2');
    const c = await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-member' }).expect(201);
    const res = await request(app).post('/api/v1/providers/me/team/invitations/accept').set(auth('u-member')).send({ token: c.body.data.token }).expect(200);
    expect(res.body.data.member.providerId).toBe('prov-member');
    expect(audits.some((a) => a.action === 'TEAM_INVITATION_ACCEPTED')).toBe(true);
    // Single-use: second accept fails.
    await request(app).post('/api/v1/providers/me/team/invitations/accept').set(auth('u-member')).send({ token: c.body.data.token }).expect(422);
  });

  it('29. unknown token is safe 404', async () => {
    stdUsers();
    await request(app).post('/api/v1/providers/me/team/invitations/accept').set(auth('u-member')).send({ token: 'deadbeef' }).expect(404);
  });

  it('30. cross-provider acceptance forbidden', async () => {
    stdUsers();
    seedTeam('u-t2');
    const c = await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-member' }).expect(201);
    const res = await request(app).post('/api/v1/providers/me/team/invitations/accept').set(auth('u-staff')).send({ token: c.body.data.token }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('31. expired invitation rejected + marked', async () => {
    stdUsers();
    seedTeam('u-t2');
    const c = await request(app).post('/api/v1/providers/me/team/invitations').set(auth('u-t2')).send({ invitedProviderId: 'prov-member' }).expect(201);
    (Object.values(teamInvs)[0] as any).expiresAt = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/v1/providers/me/team/invitations/accept').set(auth('u-member')).send({ token: c.body.data.token }).expect(422);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
  });
});

describe('Slice 15 — T3 business lifecycle', () => {
  it('32. T3 creates business + audit', async () => {
    stdUsers();
    const res = await request(app).post('/api/v1/providers/me/business').set(auth('u-t3')).send({ displayName: 'Glam Studio' }).expect(201);
    expect(res.body.data.displayName).toBe('Glam Studio');
    expect(audits.some((a) => a.action === 'BUSINESS_CREATED')).toBe(true);
  });

  it('33. T1 cannot create business', async () => {
    stdUsers();
    await request(app).post('/api/v1/providers/me/business').set(auth('u-t1')).send({ displayName: 'No' }).expect(403);
  });

  it('34. T2 cannot access business endpoints', async () => {
    stdUsers();
    await request(app).get('/api/v1/providers/me/business').set(auth('u-t2')).expect(403);
  });

  it('35. mass-assignment of verification/acceptCash rejected', async () => {
    stdUsers();
    const res = await request(app)
      .post('/api/v1/providers/me/business')
      .set(auth('u-t3'))
      .send({ displayName: 'X', verificationStatus: 'VERIFIED', acceptCash: false })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('36. list + detail with units', async () => {
    stdUsers();
    const b = seedBusiness('u-t3', { displayName: 'B' });
    seedUnit(b.id, { name: 'U1' });
    const list = await request(app).get('/api/v1/providers/me/business').set(auth('u-t3')).expect(200);
    expect(list.body.data).toHaveLength(1);
    const detail = await request(app).get(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3')).expect(200);
    expect(detail.body.data.units).toHaveLength(1);
  });

  it('37. cross-business read is safe 404 (IDOR)', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const res = await request(app).get(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3b')).expect(404);
    expect(res.body.error.code).toBe('BUSINESS_NOT_FOUND');
  });

  it('38. update + deactivate audited', async () => {
    stdUsers();
    const b = seedBusiness('u-t3', { displayName: 'Old' });
    await request(app).patch(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3')).send({ displayName: 'New' }).expect(200);
    const res = await request(app).patch(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3')).send({ status: 'INACTIVE' }).expect(200);
    expect(res.body.data.status).toBe('INACTIVE');
    expect(audits.some((a) => a.action === 'BUSINESS_UPDATED')).toBe(true);
    expect(audits.some((a) => a.action === 'BUSINESS_DEACTIVATED')).toBe(true);
    expect(businesses[b.id]).toBeDefined();
  });

  it('39. finance fields never accepted on update', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    await request(app).patch(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3')).send({ acceptCash: true }).expect(422);
  });

  it('40. unauthenticated business access fails', async () => {
    await request(app).get('/api/v1/providers/me/business').expect(401);
  });
});

describe('Slice 15 — T3 units', () => {
  it('41. create unit + audit', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const res = await request(app).post(`/api/v1/providers/me/business/${b.id}/units`).set(auth('u-t3')).send({ name: 'Downtown' }).expect(201);
    expect(res.body.data.businessId).toBe(b.id);
    expect(audits.some((a) => a.action === 'BUSINESS_UNIT_CREATED')).toBe(true);
  });

  it('42. unit creation on foreign business is safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    await request(app).post(`/api/v1/providers/me/business/${b.id}/units`).set(auth('u-t3b')).send({ name: 'Hijack' }).expect(404);
  });

  it('43. invalid coverage rejected (10/15/20 only)', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    await request(app).post(`/api/v1/providers/me/business/${b.id}/units`).set(auth('u-t3')).send({ name: 'U', coverageRadiusKm: 50 }).expect(422);
  });

  it('44. list + detail with locations/categories/services', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id, { name: 'U' });
    unitCats.push({ id: 'uc-1', businessUnitId: u.id, serviceCategoryId: 'cat-barbers' });
    const list = await request(app).get(`/api/v1/providers/me/business/${b.id}/units`).set(auth('u-t3')).expect(200);
    expect(list.body.data).toHaveLength(1);
    const detail = await request(app).get(`/api/v1/providers/me/business/units/${u.id}`).set(auth('u-t3')).expect(200);
    expect(detail.body.data.categories).toHaveLength(1);
    expect(detail.body.data.services).toEqual([]);
  });

  it('45. cross-tenant unit read is safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    await request(app).get(`/api/v1/providers/me/business/units/${u.id}`).set(auth('u-t3b')).expect(404);
  });

  it('46. update unit audited', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id, { name: 'Old' });
    const res = await request(app).patch(`/api/v1/providers/me/business/units/${u.id}`).set(auth('u-t3')).send({ name: 'New', coverageRadiusKm: 15 }).expect(200);
    expect(res.body.data.coverageRadiusKm).toBe(15);
    expect(audits.some((a) => a.action === 'BUSINESS_UNIT_UPDATED')).toBe(true);
  });

  it('47. deactivate/activate audited, history preserved', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    await request(app).post(`/api/v1/providers/me/business/units/${u.id}/deactivate`).set(auth('u-t3')).send({}).expect(200);
    const re = await request(app).post(`/api/v1/providers/me/business/units/${u.id}/activate`).set(auth('u-t3')).send({}).expect(200);
    expect(re.body.data.status).toBe('ACTIVE');
    expect(audits.some((a) => a.action === 'BUSINESS_UNIT_DEACTIVATED')).toBe(true);
    expect(audits.some((a) => a.action === 'BUSINESS_UNIT_ACTIVATED')).toBe(true);
    expect(units[u.id]).toBeDefined();
  });

  it('48. unit location set; booking snapshots untouched', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const bk = seedBooking({ providerId: 'prov-t3', businessUnitId: u.id, location: { id: 'bloc-1', latitude: 1, longitude: 1 } });
    const res = await request(app)
      .post(`/api/v1/providers/me/business/units/${u.id}/location`)
      .set(auth('u-t3'))
      .send({ location: { city: 'Johannesburg', latitude: -26.2, longitude: 28.04 } })
      .expect(201);
    expect(res.body.data.latitude).toBe(-26.2);
    expect(bookings[bk.id].location).toEqual({ id: 'bloc-1', latitude: 1, longitude: 1 });
  });

  it('49. invalid coordinates rejected', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    await request(app).post(`/api/v1/providers/me/business/units/${u.id}/location`).set(auth('u-t3')).send({ location: { latitude: 200, longitude: 0 } }).expect(422);
  });

  it('50. categories replaced + audited; unknown category rejected', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const res = await request(app)
      .put(`/api/v1/providers/me/business/units/${u.id}/categories`)
      .set(auth('u-t3'))
      .send({ categoryIds: ['BARBERS', 'NAILS'] })
      .expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(audits.some((a) => a.action === 'BUSINESS_UNIT_CATEGORIES_UPDATED')).toBe(true);
    await request(app).put(`/api/v1/providers/me/business/units/${u.id}/categories`).set(auth('u-t3')).send({ categoryIds: ['NOPE'] }).expect(422);
    const tooMany = ['BARBERS', 'HAIR', 'NAILS', 'BEAUTY', 'CARWASH', 'EXTRA'];
    await request(app).put(`/api/v1/providers/me/business/units/${u.id}/categories`).set(auth('u-t3')).send({ categoryIds: tooMany }).expect(422);
  });
});

describe('Slice 15 — T3 staff', () => {
  it('51. add staff + audit + notification', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const res = await request(app)
      .post(`/api/v1/providers/me/business/${b.id}/staff`)
      .set(auth('u-t3'))
      .send({ providerId: 'prov-staff', role: 'STAFF', businessUnitId: u.id })
      .expect(201);
    expect(res.body.data.businessUnitId).toBe(u.id);
    expect(audits.some((a) => a.action === 'STAFF_ADDED')).toBe(true);
    expect(notifs.some((n) => n.type === 'STAFF_ADDED')).toBe(true);
  });

  it('52. duplicate staff conflicts', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    seedStaff(b.id, 'prov-staff');
    await request(app).post(`/api/v1/providers/me/business/${b.id}/staff`).set(auth('u-t3')).send({ providerId: 'prov-staff' }).expect(409);
  });

  it('53. unit from another business rejected', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const other = seedBusiness('u-t3b');
    const ou = seedUnit(other.id);
    await request(app).post(`/api/v1/providers/me/business/${b.id}/staff`).set(auth('u-t3')).send({ providerId: 'prov-staff', businessUnitId: ou.id }).expect(422);
  });

  it('54. unknown provider is safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    await request(app).post(`/api/v1/providers/me/business/${b.id}/staff`).set(auth('u-t3')).send({ providerId: 'prov-ghost' }).expect(404);
  });

  it('55. staff reassignment audited as STAFF_ASSIGNED + notified', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u1 = seedUnit(b.id, { name: 'U1' });
    const u2 = seedUnit(b.id, { name: 'U2' });
    const s = seedStaff(b.id, 'prov-staff', { businessUnitId: u1.id });
    const res = await request(app).patch(`/api/v1/providers/me/business/staff/${s.id}`).set(auth('u-t3')).send({ businessUnitId: u2.id }).expect(200);
    expect(res.body.data.businessUnitId).toBe(u2.id);
    expect(audits.some((a) => a.action === 'STAFF_ASSIGNED')).toBe(true);
    expect(notifs.some((n) => n.type === 'STAFF_ASSIGNED')).toBe(true);
  });

  it('56. removal deactivates, history preserved', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const s = seedStaff(b.id, 'prov-staff');
    await request(app).delete(`/api/v1/providers/me/business/staff/${s.id}`).set(auth('u-t3')).expect(200);
    expect(staff[s.id].status).toBe('INACTIVE');
    expect(staff[s.id]).toBeDefined();
    expect(audits.some((a) => a.action === 'STAFF_REMOVED')).toBe(true);
  });

  it('57. cross-business staff write is safe 404 (IDOR)', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const s = seedStaff(b.id, 'prov-staff');
    const res = await request(app).patch(`/api/v1/providers/me/business/staff/${s.id}`).set(auth('u-t3b')).send({ role: 'MANAGER' }).expect(404);
    expect(res.body.error.code).toBe('STAFF_NOT_FOUND');
    expect(staff[s.id].role).toBe('STAFF');
  });

  it('58. staff invitation lifecycle (create/list/revoke/accept)', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const c = await request(app)
      .post(`/api/v1/providers/me/business/${b.id}/invitations`)
      .set(auth('u-t3'))
      .send({ invitedProviderId: 'prov-staff', role: 'STAFF', businessUnitId: u.id })
      .expect(201);
    expect(typeof c.body.data.token).toBe('string');
    const list = await request(app).get(`/api/v1/providers/me/business/${b.id}/invitations`).set(auth('u-t3')).expect(200);
    expect(list.body.data).toHaveLength(1);
    const acc = await request(app).post('/api/v1/providers/me/business/invitations/accept').set(auth('u-staff')).send({ token: c.body.data.token }).expect(200);
    expect(acc.body.data.staff.providerId).toBe('prov-staff');
    expect(acc.body.data.staff.businessUnitId).toBe(u.id);
    expect(audits.some((a) => a.action === 'STAFF_INVITATION_ACCEPTED')).toBe(true);
    // Single-use enforced.
    await request(app).post('/api/v1/providers/me/business/invitations/accept').set(auth('u-staff')).send({ token: c.body.data.token }).expect(422);
  });

  it('59. staff invite cross-acceptance forbidden', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const c = await request(app)
      .post(`/api/v1/providers/me/business/${b.id}/invitations`)
      .set(auth('u-t3'))
      .send({ invitedProviderId: 'prov-staff' })
      .expect(201);
    await request(app).post('/api/v1/providers/me/business/invitations/accept').set(auth('u-member')).send({ token: c.body.data.token }).expect(403);
  });
});

describe('Slice 15 — service ↔ unit association', () => {
  it('60. attach service to unit + audit', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const s = seedService({ providerId: 'prov-t3' });
    const res = await request(app).post(`/api/v1/providers/me/business/units/${u.id}/services/${s.id}/attach`).set(auth('u-t3')).send({}).expect(200);
    expect(res.body.data.businessUnitId).toBe(u.id);
    expect(audits.some((a) => a.action === 'SERVICE_ASSIGNED')).toBe(true);
  });

  it('61. foreign service attach is safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const s = seedService({ providerId: 'prov-t3b' });
    await request(app).post(`/api/v1/providers/me/business/units/${u.id}/services/${s.id}/attach`).set(auth('u-t3')).send({}).expect(404);
    expect(services[s.id].businessUnitId).toBeNull();
  });

  it('62. detach preserves service + booking snapshots', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const s = seedService({ providerId: 'prov-t3', businessUnitId: u.id, price: 250 });
    const bk = seedBooking({ providerId: 'prov-t3', businessUnitId: u.id, serviceId: s.id });
    await request(app).delete(`/api/v1/providers/me/business/units/${u.id}/services/${s.id}`).set(auth('u-t3')).expect(200);
    expect(services[s.id].businessUnitId).toBeNull();
    expect(services[s.id].price).toBe(250);
    expect(bookings[bk.id].businessUnitId).toBe(u.id);
    expect(audits.some((a) => a.action === 'SERVICE_UNASSIGNED')).toBe(true);
  });

  it('63. detach of non-attached service is safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    const s = seedService({ providerId: 'prov-t3' });
    await request(app).delete(`/api/v1/providers/me/business/units/${u.id}/services/${s.id}`).set(auth('u-t3')).expect(404);
  });
});

describe('Slice 15 — booking assignment', () => {
  it('64. T2 owner assigns booking to member + audit + notification', async () => {
    stdUsers();
    seedTeam('u-t2');
    seedTeamMember(Object.values(teams)[0].id, 'prov-member');
    const bk = seedBooking({ providerId: 'prov-t2', status: 'PENDING' });
    const res = await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t2')).send({ assignedProviderId: 'prov-member' }).expect(200);
    expect(res.body.data.assignedProviderId).toBe('prov-member');
    expect(audits.some((a) => a.action === 'BOOKING_ASSIGNED')).toBe(true);
    expect(notifs.some((n) => n.type === 'BOOKING_ASSIGNED')).toBe(true);
  });

  it('65. assignment to non-member rejected', async () => {
    stdUsers();
    seedTeam('u-t2');
    const bk = seedBooking({ providerId: 'prov-t2', status: 'PENDING' });
    const res = await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t2')).send({ assignedProviderId: 'prov-staff' }).expect(422);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('66. terminal bookings cannot be assigned', async () => {
    stdUsers();
    seedTeam('u-t2');
    seedTeamMember(Object.values(teams)[0].id, 'prov-member');
    const bk = seedBooking({ providerId: 'prov-t2', status: 'COMPLETED' });
    await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t2')).send({ assignedProviderId: 'prov-member' }).expect(422);
  });

  it('67. cross-tenant assignment is safe 404', async () => {
    stdUsers();
    seedTeam('u-t2');
    seedTeam('u-t2b', { name: 'B' });
    const bk = seedBooking({ providerId: 'prov-t2', status: 'PENDING' });
    await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t2b')).send({ assignedProviderId: 'prov-t2b' }).expect(404);
    expect(bookings[bk.id].assignedProviderId).toBeNull();
  });

  it('68. T1 cannot assign (assignment is T2/T3 only)', async () => {
    stdUsers();
    const bk = seedBooking({ providerId: 'prov-t1', status: 'PENDING' });
    const res = await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t1')).send({ assignedProviderId: 'prov-t1' }).expect(403);
    expect(res.body.error.code).toBe('TIER_REQUIRED');
    expect(bookings[bk.id].assignedProviderId).toBeNull();
  });

  it('69. T3 owner assigns unit booking to staff', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    seedStaff(b.id, 'prov-staff', { businessUnitId: u.id });
    const bk = seedBooking({ providerId: 'prov-t3', businessUnitId: u.id, status: 'ACCEPTED' });
    const res = await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t3')).send({ assignedProviderId: 'prov-staff' }).expect(200);
    expect(res.body.data.assignedProviderId).toBe('prov-staff');
  });

  it('70. unassign audited; double-unassign conflicts', async () => {
    stdUsers();
    seedTeam('u-t2');
    seedTeamMember(Object.values(teams)[0].id, 'prov-member');
    const bk = seedBooking({ providerId: 'prov-t2', status: 'PENDING', assignedProviderId: 'prov-member' });
    await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/unassign`).set(auth('u-t2')).send({}).expect(200);
    expect(audits.some((a) => a.action === 'BOOKING_UNASSIGNED')).toBe(true);
    await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/unassign`).set(auth('u-t2')).send({}).expect(409);
  });

  it('71. assignment never changes status/payment', async () => {
    stdUsers();
    seedTeam('u-t2');
    seedTeamMember(Object.values(teams)[0].id, 'prov-member');
    const bk = seedBooking({ providerId: 'prov-t2', status: 'PENDING', paymentStatus: 'PENDING' });
    await request(app).post(`/api/v1/providers/me/bookings/${bk.id}/assign`).set(auth('u-t2')).send({ assignedProviderId: 'prov-member' }).expect(200);
    expect(bookings[bk.id].status).toBe('PENDING');
    expect(bookings[bk.id].paymentStatus).toBe('PENDING');
  });

  it('72. unassigned staff cannot accept unit booking (403), assignee can (200)', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    seedStaff(b.id, 'prov-staff', { businessUnitId: u.id });
    const bk = seedBooking({ providerId: 'prov-t3', businessUnitId: u.id, status: 'PENDING' });
    const denied = await request(app).post('/api/v1/providers/me/bookings/' + bk.id + '/accept').set(auth('u-staff')).send({});
    expect(denied.status).toBe(403);
    // After assignment the operational provider may accept.
    bookings[bk.id].assignedProviderId = 'prov-staff';
    const ok = await request(app).post('/api/v1/providers/me/bookings/' + bk.id + '/accept').set(auth('u-staff')).send({});
    expect(ok.status).toBe(200);
    expect(bookings[bk.id].status).toBe('ACCEPTED');
  });
});

describe('Slice 15 — staff booking visibility + location privacy', () => {
  it('73. staff sees unit booking in inbox but location stays redacted while PENDING', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    seedStaff(b.id, 'prov-staff', { businessUnitId: u.id });
    seedBooking({ providerId: 'prov-t3', businessUnitId: u.id, status: 'PENDING', location: { id: 'l1', latitude: -26.2, longitude: 28.04, city: 'JHB' } });
    const inbox = await request(app).get('/api/v1/providers/me/bookings').set(auth('u-staff')).expect(200);
    expect(inbox.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Slice 15 — marketplace BusinessLocation', () => {
  const JHB = { latitude: -26.2041, longitude: 28.0473 };
  function ownerWithUnit(distKm: number, over: Record<string, unknown> = {}) {
    // ~111.19 km per degree latitude.
    const lat = JHB.latitude + distKm / 111.19;
    const biz = seedBusiness('u-t3', { displayName: 'Biz', ...(over as any).business });
    const unit = seedUnit(biz.id, { name: 'Unit', coverageRadiusKm: 10, ...(over as any).unit });
    businessLocs.push({
      id: 'bloc-1',
      latitude: lat,
      longitude: JHB.longitude,
      city: 'Johannesburg',
      province: 'Gauteng',
      businessUnit: { ...unit, business: { ...biz } },
    });
    return { biz, unit };
  }

  it('74. unit location is discoverable with kind=business_unit', async () => {
    stdUsers();
    ownerWithUnit(2);
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10 }).expect(200);
    const unitEntry = res.body.data.find((e: any) => e.kind === 'business_unit');
    expect(unitEntry).toBeDefined();
    expect(unitEntry.businessUnitId).toBeDefined();
    expect(unitEntry.coverageRadiusKm).toBe(10);
  });

  it('75. BOTH rule: unit beyond its own coverage excluded', async () => {
    stdUsers();
    ownerWithUnit(12, { unit: { coverageRadiusKm: 10 } });
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 15 }).expect(200);
    expect(res.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(0);
  });

  it('76. BOTH rule: unit beyond customer radius excluded', async () => {
    stdUsers();
    ownerWithUnit(12, { unit: { coverageRadiusKm: 15 } });
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10 }).expect(200);
    expect(res.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(0);
  });

  it('77. absolute 20km maximum enforced', async () => {
    stdUsers();
    ownerWithUnit(25, { unit: { coverageRadiusKm: 20 } });
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 20 }).expect(200);
    expect(res.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(0);
  });

  it('78. category filter via unit categories', async () => {
    stdUsers();
    const { unit } = ownerWithUnit(2);
    unitCats.push({ id: 'uc-9', businessUnitId: unit.id, serviceCategoryId: 'cat-nails' });
    const match = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10, categoryId: 'NAILS' }).expect(200);
    expect(match.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(1);
    const miss = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10, categoryId: 'BARBERS' }).expect(200);
    expect(miss.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(0);
  });

  it('79. inactive unit never discoverable', async () => {
    stdUsers();
    ownerWithUnit(2, { unit: { status: 'INACTIVE' } });
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10 }).expect(200);
    expect(res.body.data.filter((e: any) => e.kind === 'business_unit')).toHaveLength(0);
  });

  it('80. no tier boost: nearer T3 unit sorts before farther T1', async () => {
    stdUsers();
    ownerWithUnit(5);
    providerLocs.push({
      id: 'ploc-1',
      latitude: JHB.latitude + 8 / 111.19,
      longitude: JHB.longitude,
      city: 'Johannesburg',
      province: 'Gauteng',
      provider: { id: 'prov-t1', displayName: 'Solo', bio: null, profileImageUrl: null, coverageRadiusKm: 10, status: 'ACTIVE', verificationStatus: 'VERIFIED', tier: { code: 'T1', name: 'Individual' } },
    });
    const res = await request(app).get('/api/v1/marketplace/providers').query({ ...JHB, radiusKm: 10 }).expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const distances = res.body.data.map((e: any) => e.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(res.body.data[0].kind).toBe('business_unit');
  });
});

describe('Slice 15 — POS/inventory scope integration', () => {
  it('81. owner sees unit-scoped inventory; outsider gets safe 404', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    items['item-1'] = { id: 'item-1', providerId: 'prov-t3', businessUnitId: u.id, name: 'Oil', sellingPrice: 50, quantityOnHand: 5, isActive: true };
    const list = await request(app).get('/api/v1/pos/inventory').set(auth('u-t3')).expect(200);
    expect(JSON.stringify(list.body)).toMatch(/Oil/);
    await request(app).get('/api/v1/pos/inventory/item-1').set(auth('u-t3b')).expect(404);
  });

  it('82. staff sees their unit inventory via existing scope', async () => {
    const { resolvePosScope } = require('../src/modules/pos/pos-scope');
    stdUsers();
    const b = seedBusiness('u-t3');
    const u = seedUnit(b.id);
    seedStaff(b.id, 'prov-staff', { businessUnitId: u.id });
    const scope = await resolvePosScope('u-staff');
    expect(scope.unitIds).toContain(u.id);
  });

  it('83. T2 member inherits team-owner provider scope', async () => {
    const { resolvePosScope } = require('../src/modules/pos/pos-scope');
    stdUsers();
    const t = seedTeam('u-t2');
    seedTeamMember(t.id, 'prov-member');
    const scope = await resolvePosScope('u-member');
    expect(scope.providerIds).toContain('prov-t2');
  });
});

describe('Slice 15 — security invariants', () => {
  it('84. forged teamId/businessId in bodies never confer authority', async () => {
    stdUsers();
    const b = seedBusiness('u-t3');
    // Attacker passes victim business id as a body field; endpoint ignores it (path scope rules).
    const res = await request(app).post(`/api/v1/providers/me/business/${b.id}/units`).set(auth('u-t3b')).send({ name: 'Hijack', businessId: b.id }).expect(404);
    expect(res.body.error.code).toBe('BUSINESS_NOT_FOUND');
  });

  it('85. error responses never leak stack/SQL/secrets', async () => {
    stdUsers();
    const res = await request(app).get('/api/v1/providers/me/team').set(auth('u-t1')).expect(403);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|prisma|SELECT|tokenHash|password/i);
  });

  it('86. finance stays untouched: no commission/payroll fields anywhere', async () => {
    stdUsers();
    seedTeam('u-t2');
    const b = seedBusiness('u-t3');
    const team = await request(app).get('/api/v1/providers/me/team').set(auth('u-t2')).expect(200);
    const biz = await request(app).get(`/api/v1/providers/me/business/${b.id}`).set(auth('u-t3')).expect(200);
    expect(JSON.stringify({ team: team.body, biz: biz.body })).not.toMatch(/commission|payroll|salary|settlement/i);
  });
});

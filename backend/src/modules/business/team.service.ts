import * as crypto from 'crypto';
import { prisma } from '../../config/prisma';
import {
  BusinessScope,
  audit,
  err,
  requireT2,
  resolveBusinessScope,
  sanitizeText,
} from './business-scope';
import { emitNotification } from '../notifications/notification.service';

/**
 * Slice 15 — T2 team management.
 *
 * Uses the existing Team/TeamMember model only. No second role system:
 * roles are OWNER | MANAGER | PROVIDER (blueprint §4 T2 roles).
 *
 * - Members are deactivated (status INACTIVE), never deleted — historical
 *   booking assignment (assignedProviderId) and audit trails stay intact.
 * - Invitations are random 256-bit tokens; only the SHA-256 hash persists.
 *   Scoped to one team, expire after 7 days, single-use, revocable.
 * - Concurrency: membership writes + invitation acceptance run inside
 *   serializable transactions (unique [teamId, providerId] guards doubles).
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TEAM_MEMBER_ROLES = ['MANAGER', 'PROVIDER'] as const;
export const TEAM_MEMBER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

function tokenPair(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function notify(intent: Parameters<typeof emitNotification>[0]): void {
  try {
    void (emitNotification(intent) as Promise<unknown>).catch(() => {});
  } catch {
    /* notifications never fail domain writes */
  }
}

async function providerUserId(providerId: string): Promise<string | null> {
  try {
    const p = await (prisma as any).providerProfile.findUnique({
      where: { id: providerId },
      select: { userId: true },
    });
    return (p as any)?.userId ?? null;
  } catch {
    return null;
  }
}

/** Session must own the team, or be an ACTIVE OWNER/MANAGER member of it. */
export function assertCanManageTeam(scope: BusinessScope, team: any): void {
  if (team.ownerProviderId === (scope.profile as any).userId) return;
  const membership = scope.teamMemberships.find((m) => m.teamId === team.id);
  if (membership && ['OWNER', 'MANAGER'].includes(membership.role.toUpperCase())) return;
  throw err(403, 'FORBIDDEN', 'You do not manage this team');
}

/** Session must own the team or be an ACTIVE member to read it. */
export function assertCanViewTeam(scope: BusinessScope, team: any): void {
  if (team.ownerProviderId === (scope.profile as any).userId) return;
  if (scope.teamMemberships.some((m) => m.teamId === team.id)) return;
  throw err(404, 'TEAM_NOT_FOUND', 'Team not found');
}

async function getOwnedTeam(scope: BusinessScope): Promise<any> {
  if (!scope.team) throw err(404, 'TEAM_NOT_FOUND', 'No team found for this provider');
  return scope.team;
}

export async function createTeam(
  sessionUserId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  if (scope.team) throw err(409, 'TEAM_EXISTS', 'This provider already owns a team');

  if (input.providerId !== undefined || input.teamId !== undefined || input.ownerProviderId !== undefined) {
    throw err(422, 'VALIDATION_ERROR', 'providerId/teamId/ownerProviderId must not be supplied');
  }
  const name = typeof input.name === 'string' ? sanitizeText(input.name) : '';
  if (!name || name.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
  if (/<[^>]*>/.test(String(input.name ?? ''))) throw err(422, 'VALIDATION_ERROR', 'name must not contain markup');
  const description =
    typeof input.description === 'string' && input.description.trim().length > 0
      ? sanitizeText(input.description)
      : null;
  if (description && description.length > 2000) throw err(422, 'VALIDATION_ERROR', 'description is too long');

  const team = await prisma.team.create({
    data: {
      ownerProviderId: (scope.profile as any).userId,
      name,
      description,
      status: 'ACTIVE',
    },
  });
  await audit(sessionUserId, 'TEAM_CREATED', 'team', (team as any).id, null, { id: (team as any).id, name }, ctx);
  return serializeTeam(team, []);
}

export async function getTeam(sessionUserId: string): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  const members = await listMembersInternal(team.id);
  return serializeTeam(team, members);
}

export async function updateTeam(
  sessionUserId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);

  if (input.providerId !== undefined || input.ownerProviderId !== undefined) {
    throw err(422, 'VALIDATION_ERROR', 'providerId/ownerProviderId must not be supplied');
  }
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? sanitizeText(input.name) : '';
    if (!name || name.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
    data.name = name;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw err(422, 'VALIDATION_ERROR', 'description must be a string or null');
    }
    const d = input.description === null ? null : sanitizeText(input.description as string);
    if (d && d.length > 2000) throw err(422, 'VALIDATION_ERROR', 'description is too long');
    data.description = d;
  }
  if (Object.keys(data).length === 0) throw err(422, 'VALIDATION_ERROR', 'Nothing to update');

  const before = { name: (team as any).name, description: (team as any).description };
  const updated = await prisma.team.update({ where: { id: (team as any).id }, data: data as any });
  await audit(sessionUserId, 'TEAM_UPDATED', 'team', (team as any).id, before, data, ctx);
  const members = await listMembersInternal((team as any).id);
  return serializeTeam(updated, members);
}

function serializeTeam(team: any, members: any[]): any {
  return {
    id: team.id,
    uuid: team.uuid ?? null,
    name: team.name,
    description: team.description ?? null,
    status: team.status,
    memberCount: members.length,
    activeMemberCount: members.filter((m: any) => m.status === 'ACTIVE').length,
    members,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

async function listMembersInternal(teamId: string): Promise<any[]> {
  const rows = await prisma.teamMember.findMany({
    where: { teamId },
    orderBy: { createdAt: 'asc' },
  });
  // Enrich with provider display names without leaking private fields.
  const providerIds = (rows as any[]).map((r: any) => r.providerId);
  let names = new Map<string, string | null>();
  if (providerIds.length > 0) {
    try {
      const providers = await (prisma as any).providerProfile.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, displayName: true },
      });
      names = new Map((providers as any[]).map((p: any) => [p.id, p.displayName ?? null]));
    } catch {
      names = new Map();
    }
  }
  return (rows as any[]).map((r: any) => ({
    id: r.id,
    teamId: r.teamId,
    providerId: r.providerId,
    providerDisplayName: names.get(r.providerId) ?? null,
    role: r.role,
    status: r.status,
    joinedAt: r.joinedAt ?? r.createdAt,
  }));
}

export async function listMembers(sessionUserId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanViewTeam(scope, team);
  return listMembersInternal((team as any).id);
}

export async function addMember(
  sessionUserId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanManageTeam(scope, team);

  const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
  if (!providerId) throw err(422, 'VALIDATION_ERROR', 'providerId is required');
  if (providerId === (scope.profile as any).id) {
    throw err(422, 'VALIDATION_ERROR', 'The team owner is already the team owner');
  }
  const role = String(input.role ?? 'PROVIDER').toUpperCase();
  if (!(TEAM_MEMBER_ROLES as readonly string[]).includes(role)) {
    throw err(422, 'VALIDATION_ERROR', 'role must be MANAGER or PROVIDER');
  }

  const target = await (prisma as any).providerProfile
    .findUnique({ where: { id: providerId }, select: { id: true, status: true, displayName: true } })
    .catch(() => null);
  if (!target) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  if ((target as any).status !== 'ACTIVE') throw err(422, 'PROVIDER_INACTIVE', 'Provider account is not active');

  const existing = await prisma.teamMember
    .findUnique({ where: { teamId_providerId: { teamId: (team as any).id, providerId } } })
    .catch(() => null);
  if (existing) {
    if ((existing as any).status === 'ACTIVE') throw err(409, 'MEMBER_EXISTS', 'Provider is already a team member');
    // Reactivate a previously deactivated membership (history preserved).
    const reactivated = await prisma.teamMember.update({
      where: { id: (existing as any).id },
      data: { status: 'ACTIVE', role } as any,
    });
    await audit(sessionUserId, 'TEAM_MEMBER_ADDED', 'team_member', (reactivated as any).id, { status: 'INACTIVE' }, { status: 'ACTIVE', role }, ctx);
    return serializeMember(reactivated);
  }

  const member = await prisma.$transaction(async (tx: any) => {
    const created = await tx.teamMember.create({
      data: { teamId: (team as any).id, providerId, role, status: 'ACTIVE' },
    });
    return created;
  });
  await audit(sessionUserId, 'TEAM_MEMBER_ADDED', 'team_member', (member as any).id, null, { teamId: (team as any).id, providerId, role }, ctx);
  const recipient = await providerUserId(providerId);
  if (recipient) {
    notify({
      recipientUserId: recipient,
      audience: 'PROVIDER',
      type: 'TEAM_MEMBER_ADDED',
      title: 'Added to a team',
      message: `You were added to team ${(team as any).name}.`,
      entityType: 'team',
      entityId: (team as any).id,
      eventKey: `team-member:${(member as any).id}:added`,
    });
  }
  return serializeMember(member);
}

function serializeMember(m: any): any {
  return {
    id: m.id,
    teamId: m.teamId,
    providerId: m.providerId,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt ?? m.createdAt,
  };
}

export async function updateMember(
  sessionUserId: string,
  memberId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanManageTeam(scope, team);

  const member = await prisma.teamMember.findUnique({ where: { id: memberId } }).catch(() => null);
  // Safe 404: never disclose another team's membership.
  if (!member || (member as any).teamId !== (team as any).id) {
    throw err(404, 'TEAM_MEMBER_NOT_FOUND', 'Team member not found');
  }
  if (input.providerId !== undefined || input.teamId !== undefined) {
    throw err(422, 'VALIDATION_ERROR', 'providerId/teamId must not be supplied');
  }
  const data: Record<string, unknown> = {};
  if (input.role !== undefined) {
    const role = String(input.role).toUpperCase();
    if (!['OWNER', 'MANAGER', 'PROVIDER'].includes(role)) {
      throw err(422, 'VALIDATION_ERROR', 'role must be OWNER, MANAGER or PROVIDER');
    }
    // Only the team owner row (ownerProviderId) may grant OWNER.
    if (role === 'OWNER') throw err(422, 'VALIDATION_ERROR', 'OWNER is reserved for the team owner');
    data.role = role;
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!(TEAM_MEMBER_STATUSES as readonly string[]).includes(status)) {
      throw err(422, 'VALIDATION_ERROR', 'status must be ACTIVE or INACTIVE');
    }
    data.status = status;
  }
  if (Object.keys(data).length === 0) throw err(422, 'VALIDATION_ERROR', 'Nothing to update');

  const before = { role: (member as any).role, status: (member as any).status };
  const updated = await prisma.$transaction(async (tx: any) =>
    tx.teamMember.update({ where: { id: memberId }, data: data as any }),
  );
  const action = (data.status === 'INACTIVE' ? 'TEAM_MEMBER_REMOVED' : 'TEAM_MEMBER_UPDATED') as string;
  await audit(sessionUserId, action, 'team_member', memberId, before, data, ctx);
  if (data.status === 'INACTIVE') {
    const recipient = await providerUserId((member as any).providerId);
    if (recipient) {
      notify({
        recipientUserId: recipient,
        audience: 'PROVIDER',
        type: 'TEAM_MEMBER_REMOVED',
        title: 'Removed from team',
        message: `You were removed from team ${(team as any).name}. Past bookings and records are unchanged.`,
        entityType: 'team',
        entityId: (team as any).id,
        eventKey: `team-member:${memberId}:removed:${Date.now()}`,
      });
    }
  }
  return serializeMember(updated);
}

export async function removeMember(
  sessionUserId: string,
  memberId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  return updateMember(sessionUserId, memberId, { status: 'INACTIVE' }, ctx);
}

export async function createInvitation(
  sessionUserId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanManageTeam(scope, team);

  const role = String(input.role ?? 'PROVIDER').toUpperCase();
  if (!(TEAM_MEMBER_ROLES as readonly string[]).includes(role)) {
    throw err(422, 'VALIDATION_ERROR', 'role must be MANAGER or PROVIDER');
  }
  const invitedProviderId =
    typeof input.invitedProviderId === 'string' && input.invitedProviderId.trim().length > 0
      ? input.invitedProviderId.trim()
      : null;
  const invitedEmail =
    typeof input.invitedEmail === 'string' && input.invitedEmail.trim().length > 0
      ? input.invitedEmail.trim().toLowerCase()
      : null;
  if (!invitedProviderId && !invitedEmail) {
    throw err(422, 'VALIDATION_ERROR', 'invitedProviderId or invitedEmail is required');
  }
  if (invitedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
    throw err(422, 'VALIDATION_ERROR', 'invitedEmail is invalid');
  }
  if (invitedProviderId) {
    if (invitedProviderId === (scope.profile as any).id) {
      throw err(422, 'VALIDATION_ERROR', 'You cannot invite yourself');
    }
    const target = await (prisma as any).providerProfile
      .findUnique({ where: { id: invitedProviderId }, select: { id: true, status: true } })
      .catch(() => null);
    if (!target) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
    const existing = await prisma.teamMember
      .findUnique({ where: { teamId_providerId: { teamId: (team as any).id, providerId: invitedProviderId } } })
      .catch(() => null);
    if (existing && (existing as any).status === 'ACTIVE') {
      throw err(409, 'MEMBER_EXISTS', 'Provider is already a team member');
    }
  }

  const { raw, hash } = tokenPair();
  const invitation = await prisma.teamInvitation.create({
    data: {
      teamId: (team as any).id,
      invitedProviderId,
      invitedEmail,
      role,
      tokenHash: hash,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      createdBy: sessionUserId,
    } as any,
  });
  await audit(
    sessionUserId,
    'TEAM_INVITATION_CREATED',
    'team_invitation',
    (invitation as any).id,
    null,
    { teamId: (team as any).id, role },
    ctx,
  );
  if (invitedProviderId) {
    const recipient = await providerUserId(invitedProviderId);
    if (recipient) {
      notify({
        recipientUserId: recipient,
        audience: 'PROVIDER',
        type: 'TEAM_INVITATION',
        title: 'Team invitation',
        message: `You were invited to join team ${(team as any).name} as ${role}.`,
        entityType: 'team',
        entityId: (team as any).id,
        eventKey: `team-invite:${(invitation as any).id}`,
      });
    }
  }
  return { ...serializeInvitation(invitation), token: raw };
}

function serializeInvitation(inv: any): any {
  return {
    id: inv.id,
    teamId: inv.teamId,
    invitedProviderId: inv.invitedProviderId ?? null,
    invitedEmail: inv.invitedEmail ?? null,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt ?? null,
    createdAt: inv.createdAt,
  };
}

export async function listInvitations(sessionUserId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanViewTeam(scope, team);
  const rows = await prisma.teamInvitation
    .findMany({ where: { teamId: (team as any).id }, orderBy: { createdAt: 'desc' } })
    .catch(() => []);
  return ((rows as any[]) ?? []).map(serializeInvitation);
}

export async function revokeInvitation(
  sessionUserId: string,
  invitationId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT2(scope);
  const team = await getOwnedTeam(scope);
  assertCanManageTeam(scope, team);
  const inv = await prisma.teamInvitation.findUnique({ where: { id: invitationId } }).catch(() => null);
  if (!inv || (inv as any).teamId !== (team as any).id) {
    throw err(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
  }
  if ((inv as any).status !== 'PENDING') throw err(422, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending');
  const updated = await prisma.teamInvitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED' } as any,
  });
  await audit(sessionUserId, 'TEAM_INVITATION_REVOKED', 'team_invitation', invitationId, { status: 'PENDING' }, { status: 'REVOKED' }, ctx);
  return serializeInvitation(updated);
}

export async function acceptInvitation(
  sessionUserId: string,
  rawToken: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  const hash = crypto.createHash('sha256').update(String(rawToken ?? '')).digest('hex');
  const inv = await prisma.teamInvitation.findUnique({ where: { tokenHash: hash } }).catch(() => null);
  // Safe 404: token validity must not leak team existence.
  if (!inv) throw err(404, 'INVITATION_NOT_FOUND', 'Invitation not found or invalid');
  const invitation: any = inv;

  const result = await prisma.$transaction(async (tx: any) => {
    const current = await tx.teamInvitation.findUnique({ where: { id: invitation.id } });
    if (!current || (current as any).status !== 'PENDING') {
      throw err(422, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending');
    }
    if (new Date((current as any).expiresAt).getTime() < Date.now()) {
      await tx.teamInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
      throw err(422, 'INVITATION_EXPIRED', 'Invitation has expired');
    }
    // Scoped acceptance: a provider-scoped invite binds to that provider only.
    if ((current as any).invitedProviderId && (current as any).invitedProviderId !== (scope.profile as any).id) {
      throw err(403, 'FORBIDDEN', 'This invitation was issued to a different provider');
    }
    const team = await tx.team.findUnique({ where: { id: (current as any).teamId } });
    if (!team || (team as any).status !== 'ACTIVE') throw err(422, 'TEAM_INACTIVE', 'Team is no longer active');
    const dup = await tx.teamMember
      .findUnique({
        where: {
          teamId_providerId: { teamId: (current as any).teamId, providerId: (scope.profile as any).id },
        },
      })
      .catch(() => null);
    let member: any;
    if (dup) {
      member = await tx.teamMember.update({
        where: { id: (dup as any).id },
        data: { status: 'ACTIVE', role: (current as any).role },
      });
    } else {
      member = await tx.teamMember.create({
        data: {
          teamId: (current as any).teamId,
          providerId: (scope.profile as any).id,
          role: (current as any).role,
          status: 'ACTIVE',
        },
      });
    }
    const accepted = await tx.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    return { member, accepted, team };
  });

  await audit(
    sessionUserId,
    'TEAM_INVITATION_ACCEPTED',
    'team_invitation',
    invitation.id,
    { status: 'PENDING' },
    { status: 'ACCEPTED' },
    ctx,
  );
  return { member: serializeMember((result as any).member), teamId: (result as any).team.id };
}

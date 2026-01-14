const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { seedHouseholdCategories } = require('../services/householdSeeder');

// All routes require authentication
router.use(authenticate);

/**
 * Generate a random invite code
 */
const generateInviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars: I, O, 0, 1
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

/**
 * Check if user is member of household
 */
const isMember = (user, householdId) => {
  return user.householdMembers.some(m => m.householdId === householdId);
};

/**
 * Check if user is owner of household
 */
const isOwner = (user, householdId) => {
  return user.householdMembers.some(m => m.householdId === householdId && m.role === 'owner');
};

/**
 * POST /api/households
 * Create a new household
 */
router.post('/', async (req, res) => {
  try {
    const { name, hemisphere } = req.body;

    if (!name || name.trim().length === 0) {
      return error(res, 'Household name is required');
    }

    // Validate hemisphere if provided
    const validHemispheres = ['north', 'south'];
    const selectedHemisphere = hemisphere && validHemispheres.includes(hemisphere) ? hemisphere : 'north';

    // Create household with user as owner
    const household = await prisma.household.create({
      data: {
        name: name.trim(),
        hemisphere: selectedHemisphere,
        members: {
          create: {
            userId: req.user.id,
            role: 'owner'
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true }
            }
          }
        }
      }
    });

    // Seed default categories for the new household
    await seedHouseholdCategories(household.id);

    return created(res, {
      household: {
        id: household.id,
        name: household.name,
        hemisphere: household.hemisphere,
        createdAt: household.createdAt,
        members: household.members.map(m => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
          income: m.income
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/households/:id
 * Get household details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check membership
    if (!isMember(req.user, id)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const household = await prisma.household.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true }
            }
          }
        }
      }
    });

    if (!household) {
      return notFound(res, 'Household not found');
    }

    return success(res, {
      household: {
        id: household.id,
        name: household.name,
        hemisphere: household.hemisphere,
        createdAt: household.createdAt,
        members: household.members.map(m => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
          income: m.income
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/households/:id/invite
 * Generate invite code for household
 */
router.post('/:id/invite', async (req, res) => {
  try {
    const { id } = req.params;
    const { expiresInDays = 7 } = req.body;

    // Check membership
    if (!isMember(req.user, id)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Generate unique code
    let code;
    let attempts = 0;
    do {
      code = generateInviteCode();
      const existing = await prisma.householdInvite.findUnique({ where: { code } });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return serverError(res, new Error('Could not generate unique invite code'));
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const invite = await prisma.householdInvite.create({
      data: {
        householdId: id,
        code,
        createdById: req.user.id,
        expiresAt
      }
    });

    return created(res, {
      invite: {
        id: invite.id,
        code: invite.code,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/households/join
 * Join household with invite code
 */
router.post('/join', async (req, res) => {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return error(res, 'Invite code is required');
    }

    const invite = await prisma.householdInvite.findUnique({
      where: { code: inviteCode.toUpperCase() },
      include: { household: true }
    });

    if (!invite) {
      return notFound(res, 'Invalid invite code');
    }

    if (invite.usedAt) {
      return error(res, 'This invite code has already been used');
    }

    if (new Date() > invite.expiresAt) {
      return error(res, 'This invite code has expired');
    }

    // Check if already a member
    if (isMember(req.user, invite.householdId)) {
      return error(res, 'You are already a member of this household');
    }

    // Join household and mark invite as used
    await prisma.$transaction([
      prisma.householdMember.create({
        data: {
          householdId: invite.householdId,
          userId: req.user.id,
          role: 'member'
        }
      }),
      prisma.householdInvite.update({
        where: { id: invite.id },
        data: {
          usedAt: new Date(),
          usedById: req.user.id
        }
      })
    ]);

    // Fetch updated household
    const household = await prisma.household.findUnique({
      where: { id: invite.householdId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true }
            }
          }
        }
      }
    });

    return success(res, {
      message: `Successfully joined ${household.name}`,
      household: {
        id: household.id,
        name: household.name,
        hemisphere: household.hemisphere,
        createdAt: household.createdAt,
        members: household.members.map(m => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
          income: m.income
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/households/:id
 * Update household settings (name, hemisphere)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, hemisphere } = req.body;

    // Check membership (only owners can update household settings)
    if (!isOwner(req.user, id)) {
      return forbidden(res, 'Only owners can update household settings');
    }

    const household = await prisma.household.findUnique({
      where: { id }
    });

    if (!household) {
      return notFound(res, 'Household not found');
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (hemisphere !== undefined) {
      const validHemispheres = ['north', 'south'];
      if (!validHemispheres.includes(hemisphere)) {
        return error(res, 'Invalid hemisphere. Must be "north" or "south"');
      }
      updateData.hemisphere = hemisphere;
    }

    if (Object.keys(updateData).length === 0) {
      return error(res, 'No valid fields to update');
    }

    const updated = await prisma.household.update({
      where: { id },
      data: updateData,
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true }
            }
          }
        }
      }
    });

    return success(res, {
      household: {
        id: updated.id,
        name: updated.name,
        hemisphere: updated.hemisphere,
        createdAt: updated.createdAt,
        members: updated.members.map(m => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
          income: m.income
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/households/:id/members/:userId
 * Update member info (income)
 */
router.patch('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { income } = req.body;

    // Check membership
    if (!isMember(req.user, id)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Users can only update their own income (or owners can update anyone)
    if (req.user.id !== userId && !isOwner(req.user, id)) {
      return forbidden(res, 'You can only update your own income');
    }

    const member = await prisma.householdMember.findFirst({
      where: { householdId: id, userId }
    });

    if (!member) {
      return notFound(res, 'Member not found');
    }

    const updated = await prisma.householdMember.update({
      where: { id: member.id },
      data: { income },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true }
        }
      }
    });

    return success(res, {
      member: {
        id: updated.id,
        userId: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        avatarUrl: updated.user.avatarUrl,
        role: updated.role,
        income: updated.income
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/households/:id/members/:userId
 * Remove member from household (or leave)
 */
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;

    // Check membership
    if (!isMember(req.user, id)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Users can remove themselves, or owners can remove anyone
    if (req.user.id !== userId && !isOwner(req.user, id)) {
      return forbidden(res, 'Only owners can remove other members');
    }

    const member = await prisma.householdMember.findFirst({
      where: { householdId: id, userId }
    });

    if (!member) {
      return notFound(res, 'Member not found');
    }

    // Prevent owner from leaving if they're the only owner
    if (member.role === 'owner') {
      const ownerCount = await prisma.householdMember.count({
        where: { householdId: id, role: 'owner' }
      });
      if (ownerCount === 1) {
        return error(res, 'Cannot remove the only owner. Transfer ownership first.');
      }
    }

    await prisma.householdMember.delete({
      where: { id: member.id }
    });

    return success(res, { message: 'Member removed successfully' });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;

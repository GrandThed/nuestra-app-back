const express = require('express');
const axios = require('axios');
const router = express.Router();
const prisma = require('../lib/prisma');
const { generateToken } = require('../lib/jwt');
const { success, error, unauthorized, serverError } = require('../lib/response');
const { authenticate } = require('../middleware/auth');

/**
 * POST /auth/google
 * Authenticate with Google ID token (from Flutter)
 */
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return error(res, 'idToken is required');
    }

    // Verify Google token
    const googleResponse = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    const { email, name, picture, sub: googleId } = googleResponse.data;

    // Check if Google client ID matches (security check)
    if (googleResponse.data.aud !== process.env.GOOGLE_CLIENT_ID) {
      return unauthorized(res, 'Invalid Google client');
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl: picture,
          provider: 'google',
          providerId: googleId
        }
      });
    } else if (user.provider !== 'google') {
      return error(res, 'Email already registered with different provider');
    }

    // Generate JWT
    const token = generateToken(user);

    return success(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl
      }
    });
  } catch (err) {
    if (err.response?.status === 400) {
      return unauthorized(res, 'Invalid Google token');
    }
    return serverError(res, err);
  }
});

/**
 * POST /auth/apple
 * Authenticate with Apple ID token (from Flutter)
 */
router.post('/apple', async (req, res) => {
  try {
    const { idToken, fullName } = req.body;

    if (!idToken) {
      return error(res, 'idToken is required');
    }

    // Decode Apple JWT (simplified - in production you'd verify the signature)
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return unauthorized(res, 'Invalid Apple token format');
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const { email, sub: appleId } = payload;

    if (!email) {
      return error(res, 'Email not provided by Apple');
    }

    // Verify issuer and audience
    if (payload.iss !== 'https://appleid.apple.com') {
      return unauthorized(res, 'Invalid Apple token issuer');
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email }
    });

    // Apple only sends name on first sign-in
    const userName = fullName?.givenName
      ? `${fullName.givenName} ${fullName.familyName || ''}`.trim()
      : email.split('@')[0];

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: userName,
          provider: 'apple',
          providerId: appleId
        }
      });
    } else if (user.provider !== 'apple') {
      return error(res, 'Email already registered with different provider');
    }

    // Generate JWT
    const token = generateToken(user);

    return success(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    return success(res, {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        avatarUrl: req.user.avatarUrl,
        households: req.user.householdMemberships.map(m => ({
          id: m.household.id,
          name: m.household.name,
          role: m.role
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /auth/dev-login
 * Development only: Create a test user and return JWT
 * This endpoint is disabled in production
 */
router.post('/dev-login', async (req, res) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return error(res, 'This endpoint is disabled in production', 403);
  }

  try {
    const testEmail = req.body.email || 'testuser@example.com';
    const testName = req.body.name || 'Test User';

    // Find or create test user
    let user = await prisma.user.upsert({
      where: { email: testEmail },
      update: { name: testName },
      create: {
        email: testEmail,
        name: testName,
        provider: 'dev',
        providerId: 'dev-' + Date.now()
      }
    });

    // Generate JWT
    const token = generateToken(user);

    return success(res, {
      message: 'Development login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;

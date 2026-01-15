const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError, noContent } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { uploadImage, handleUploadError } = require('../middleware/upload');
const { uploadFile, deleteFile, getSignedDownloadUrl, uploadImageWithThumbnail } = require('../services/storage');
const { fetchLinkPreview } = require('../services/linkPreview');

// All routes require authentication
router.use(authenticate);

/**
 * Check if user is member of household
 */
const isMember = (user, householdId) => {
  return user.householdMembers.some(m => m.householdId === householdId);
};

/**
 * Generate fresh signed URLs for board items
 * Stored values are S3 keys (e.g., "boards/householdId/file.jpg")
 */
const refreshItemUrls = async (item) => {
  const refreshed = { ...item };

  if (item.url && item.type === 'photo') {
    // item.url is the S3 key - pass directly to get signed URL
    refreshed.url = await getSignedDownloadUrl(item.url, 7 * 24 * 60 * 60);
  }

  if (item.thumbnailUrl) {
    refreshed.thumbnailUrl = await getSignedDownloadUrl(item.thumbnailUrl, 7 * 24 * 60 * 60);
  }

  if (item.photoBackDrawingUrl) {
    refreshed.photoBackDrawingUrl = await getSignedDownloadUrl(item.photoBackDrawingUrl, 7 * 24 * 60 * 60);
  }

  return refreshed;
};

/**
 * GET /api/boards
 * List all boards for a household
 */
router.get('/', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const boards = await prisma.board.findMany({
      where: { householdId },
      include: {
        _count: {
          select: { items: true }
        },
        items: {
          take: 4,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            thumbnailUrl: true,
            linkPreviewImage: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Map boards with preview items (signed URLs for photos)
    const boardsWithPreviews = await Promise.all(boards.map(async b => {
      const previewItems = await Promise.all(
        b.items.map(async item => {
          if (item.type === 'photo' && item.thumbnailUrl) {
            return await getSignedDownloadUrl(item.thumbnailUrl, 7 * 24 * 60 * 60);
          }
          return item.linkPreviewImage; // Public URL for links
        })
      );

      return {
        id: b.id,
        name: b.name,
        coverUrl: b.coverUrl,
        itemCount: b._count.items,
        createdAt: b.createdAt,
        previewItems: previewItems.filter(Boolean)
      };
    }));

    return success(res, { boards: boardsWithPreviews });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/boards
 * Create a new board
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, name } = req.body;

    if (!householdId || !name) {
      return error(res, 'householdId and name are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const board = await prisma.board.create({
      data: {
        householdId,
        name: name.trim(),
        createdById: req.user.id
      }
    });

    return created(res, {
      board: {
        id: board.id,
        name: board.name,
        coverUrl: board.coverUrl,
        createdAt: board.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/boards/:id
 * Get board with items
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const board = await prisma.board.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            createdBy: {
              select: { id: true, name: true, avatarUrl: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!board) {
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Refresh signed URLs for photo items
    const itemsWithFreshUrls = await Promise.all(
      board.items.map(async (item) => {
        if (item.type === 'photo') {
          return refreshItemUrls(item);
        }
        return item;
      })
    );

    return success(res, {
      board: {
        id: board.id,
        name: board.name,
        coverUrl: board.coverUrl,
        createdAt: board.createdAt,
        items: itemsWithFreshUrls.map(item => ({
          id: item.id,
          type: item.type,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          title: item.title,
          description: item.description,
          linkPreviewImage: item.linkPreviewImage,
          photoBackDrawingUrl: item.photoBackDrawingUrl,
          photoBackText: item.photoBackText,
          photoBackDate: item.photoBackDate,
          photoBackPlace: item.photoBackPlace,
          createdBy: item.createdBy,
          createdAt: item.createdAt
        }))
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/boards/:id
 * Delete a board and all its items
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const board = await prisma.board.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!board) {
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Delete all photo files from storage
    for (const item of board.items) {
      if (item.type === 'photo' && item.url) {
        try {
          const key = `boards/${item.url.split('/boards/')[1]?.split('?')[0]}`;
          if (key) await deleteFile(key);
        } catch (e) {
          console.error('Failed to delete file:', e);
        }
      }
    }

    // Delete board (cascades to items)
    await prisma.board.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/boards/:id/items/link
 * Add a link item to a board
 */
router.post('/:id/items/link', async (req, res) => {
  try {
    const { id } = req.params;
    const { url, title, description } = req.body;

    if (!url) {
      return error(res, 'URL is required');
    }

    const board = await prisma.board.findUnique({
      where: { id }
    });

    if (!board) {
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Fetch link preview
    const preview = await fetchLinkPreview(url);

    const item = await prisma.boardItem.create({
      data: {
        boardId: id,
        type: 'link',
        url,
        title: title || preview.title,
        description: description || preview.description,
        linkPreviewImage: preview.image,
        createdById: req.user.id
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    return created(res, {
      item: {
        id: item.id,
        type: item.type,
        url: item.url,
        title: item.title,
        description: item.description,
        linkPreviewImage: item.linkPreviewImage,
        createdBy: item.createdBy,
        createdAt: item.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/boards/:id/items/photo
 * Add a photo item to a board
 */
router.post('/:id/items/photo', uploadImage.single('photo'), handleUploadError, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    if (!req.file) {
      return error(res, 'Photo file is required');
    }

    const board = await prisma.board.findUnique({
      where: { id }
    });

    if (!board) {
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Upload photo with thumbnail generation
    const uploadResult = await uploadImageWithThumbnail(
      req.file.buffer,
      req.file.originalname,
      `boards/${board.householdId}`,
      req.file.mimetype
    );

    const item = await prisma.boardItem.create({
      data: {
        boardId: id,
        type: 'photo',
        url: uploadResult.key, // Store key, not full URL
        thumbnailUrl: uploadResult.thumbnailKey, // Store thumbnail key
        title: title || null,
        description: description || null,
        createdById: req.user.id
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    return created(res, {
      item: {
        id: item.id,
        type: item.type,
        url: uploadResult.url,
        thumbnailUrl: uploadResult.thumbnailUrl,
        title: item.title,
        description: item.description,
        createdBy: item.createdBy,
        createdAt: item.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/boards/:id/items/:itemId
 * Update a board item (including photo flip side)
 */
router.patch('/:id/items/:itemId', uploadImage.single('drawing'), handleUploadError, async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { title, description, photoBackText, photoBackDate, photoBackPlace } = req.body;

    const board = await prisma.board.findUnique({
      where: { id }
    });

    if (!board) {
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const item = await prisma.boardItem.findUnique({
      where: { id: itemId }
    });

    if (!item || item.boardId !== id) {
      return notFound(res, 'Item not found');
    }

    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    // Photo flip side fields (only for photo items)
    if (item.type === 'photo') {
      if (photoBackText !== undefined) updateData.photoBackText = photoBackText;
      if (photoBackDate !== undefined) updateData.photoBackDate = photoBackDate ? new Date(photoBackDate) : null;
      if (photoBackPlace !== undefined) updateData.photoBackPlace = photoBackPlace;

      // Handle drawing upload
      if (req.file) {
        // Delete old drawing if exists
        if (item.photoBackDrawingUrl) {
          try {
            await deleteFile(item.photoBackDrawingUrl);
          } catch (e) {
            console.error('Failed to delete old drawing:', e);
          }
        }

        const uploadResult = await uploadFile(
          req.file.buffer,
          req.file.originalname,
          `boards/${board.householdId}/drawings`,
          req.file.mimetype
        );

        updateData.photoBackDrawingUrl = uploadResult.key;
      }
    }

    const updatedItem = await prisma.boardItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    // Refresh URLs for response
    const itemWithUrls = updatedItem.type === 'photo' ? await refreshItemUrls(updatedItem) : updatedItem;

    return success(res, {
      item: {
        id: itemWithUrls.id,
        type: itemWithUrls.type,
        url: itemWithUrls.url,
        thumbnailUrl: itemWithUrls.thumbnailUrl,
        title: itemWithUrls.title,
        description: itemWithUrls.description,
        linkPreviewImage: itemWithUrls.linkPreviewImage,
        photoBackDrawingUrl: itemWithUrls.photoBackDrawingUrl,
        photoBackText: itemWithUrls.photoBackText,
        photoBackDate: itemWithUrls.photoBackDate,
        photoBackPlace: itemWithUrls.photoBackPlace,
        createdBy: itemWithUrls.createdBy,
        createdAt: itemWithUrls.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/boards/:id/items/:itemId
 * Delete a board item
 */
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { id, itemId } = req.params;
    console.log('DELETE item - boardId:', id, 'itemId:', itemId);

    const board = await prisma.board.findUnique({
      where: { id }
    });

    if (!board) {
      console.log('Board not found for id:', id);
      return notFound(res, 'Board not found');
    }

    if (!isMember(req.user, board.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const item = await prisma.boardItem.findUnique({
      where: { id: itemId }
    });

    if (!item || item.boardId !== id) {
      return notFound(res, 'Item not found');
    }

    // Delete files from storage if photo
    if (item.type === 'photo') {
      if (item.url) {
        try {
          await deleteFile(item.url);
        } catch (e) {
          console.error('Failed to delete photo:', e);
        }
      }
      if (item.thumbnailUrl) {
        try {
          await deleteFile(item.thumbnailUrl);
        } catch (e) {
          console.error('Failed to delete thumbnail:', e);
        }
      }
      if (item.photoBackDrawingUrl) {
        try {
          await deleteFile(item.photoBackDrawingUrl);
        } catch (e) {
          console.error('Failed to delete drawing:', e);
        }
      }
    }

    await prisma.boardItem.delete({
      where: { id: itemId }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;

const prisma = require('../lib/prisma');
const axios = require('axios');
const { downloadFileBuffer, generateCompositeThumbnail, deleteFile, uploadFile } = require('./storage');

/**
 * Regenerate the composite thumbnail for a board.
 * Called fire-and-forget after item add/delete/reorder.
 *
 * @param {string} boardId
 */
const regenerateBoardComposite = async (boardId) => {
  try {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      include: {
        items: {
          where: {
            OR: [
              { type: 'photo', thumbnailUrl: { not: null } },
              { type: 'link', linkPreviewImage: { not: null } }
            ]
          },
          take: 4,
          orderBy: { createdAt: 'desc' },
          select: {
            type: true,
            thumbnailUrl: true,
            linkPreviewImage: true
          }
        }
      }
    });

    if (!board) return;

    // Delete old composite if exists
    if (board.compositeThumbnailKey) {
      try {
        await deleteFile(board.compositeThumbnailKey);
      } catch (e) {
        console.error('Failed to delete old composite thumbnail:', e.message);
      }
    }

    // If no items with images, clear the composite
    if (board.items.length === 0) {
      await prisma.board.update({
        where: { id: boardId },
        data: { compositeThumbnailKey: null }
      });
      return;
    }

    // Download image buffers
    const imageBuffers = [];
    for (const item of board.items) {
      try {
        if (item.type === 'photo' && item.thumbnailUrl) {
          const buf = await downloadFileBuffer(item.thumbnailUrl);
          imageBuffers.push(buf);
        } else if (item.type === 'link' && item.linkPreviewImage) {
          const response = await axios.get(item.linkPreviewImage, {
            responseType: 'arraybuffer',
            timeout: 5000
          });
          imageBuffers.push(Buffer.from(response.data));
        }
      } catch (e) {
        console.error('Failed to download image for composite:', e.message);
      }
    }

    if (imageBuffers.length === 0) {
      await prisma.board.update({
        where: { id: boardId },
        data: { compositeThumbnailKey: null }
      });
      return;
    }

    // Generate and upload composite
    const compositeBuffer = await generateCompositeThumbnail(imageBuffers);
    const uploadResult = await uploadFile(
      compositeBuffer,
      'composite.webp',
      `boards/${board.householdId}/composites`,
      'image/webp'
    );

    await prisma.board.update({
      where: { id: boardId },
      data: { compositeThumbnailKey: uploadResult.key }
    });
  } catch (err) {
    console.error(`Failed to regenerate composite for board ${boardId}:`, err.message);
  }
};

module.exports = { regenerateBoardComposite };

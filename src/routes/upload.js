const express = require('express');
const router = express.Router();
const { success, error, serverError } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { uploadImage, handleUploadError } = require('../middleware/upload');
const { uploadFile, deleteFileByUrl } = require('../services/storage');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/upload/image
 * Upload a single image (for testing)
 */
router.post('/image', uploadImage.single('image'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return error(res, 'No image file provided');
    }

    const result = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'uploads', // test folder
      req.file.mimetype
    );

    return success(res, {
      message: 'Image uploaded successfully',
      file: {
        url: result.url,
        key: result.key,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/upload
 * Delete a file by URL (for testing)
 */
router.delete('/', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return error(res, 'URL is required');
    }

    await deleteFileByUrl(url);

    return success(res, { message: 'File deleted successfully' });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;

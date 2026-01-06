const multer = require('multer');
const { ALLOWED_IMAGE_TYPES, ALLOWED_DOCUMENT_TYPES } = require('../services/storage');

/**
 * Multer configuration for memory storage
 * Files are stored in memory as Buffer for direct upload to S3
 * No file size limit - Railway/S3 handles large files
 */
const storage = multer.memoryStorage();

/**
 * File filter for images only
 */
const imageFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`), false);
  }
};

/**
 * File filter for images and documents
 */
const documentFilter = (req, file, cb) => {
  if (ALLOWED_DOCUMENT_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`), false);
  }
};

/**
 * Upload middleware for single image
 * Usage: uploadImage.single('photo')
 */
const uploadImage = multer({
  storage,
  fileFilter: imageFilter
});

/**
 * Upload middleware for single document (images + PDF)
 * Usage: uploadDocument.single('file')
 */
const uploadDocument = multer({
  storage,
  fileFilter: documentFilter
});

/**
 * Upload middleware for multiple images
 * Usage: uploadImages.array('photos', 10)
 */
const uploadImages = multer({
  storage,
  fileFilter: imageFilter
});

/**
 * Error handler middleware for multer errors
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  next();
};

module.exports = {
  uploadImage,
  uploadDocument,
  uploadImages,
  handleUploadError
};

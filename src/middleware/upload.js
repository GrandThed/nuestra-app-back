const multer = require('multer');
const { MAX_FILE_SIZE, ALLOWED_IMAGE_TYPES, ALLOWED_DOCUMENT_TYPES } = require('../services/storage');

/**
 * Multer configuration for memory storage
 * Files are stored in memory as Buffer for direct upload to S3
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
  fileFilter: imageFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

/**
 * Upload middleware for single document (images + PDF)
 * Usage: uploadDocument.single('file')
 */
const uploadDocument = multer({
  storage,
  fileFilter: documentFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

/**
 * Upload middleware for multiple images
 * Usage: uploadImages.array('photos', 10)
 */
const uploadImages = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

/**
 * Error handler middleware for multer errors
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }
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

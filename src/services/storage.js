const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, BUCKET_NAME } = require('../config/storage');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

/**
 * Generate a unique filename with original extension
 */
const generateFileName = (originalName) => {
  const ext = path.extname(originalName);
  const uniqueId = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${uniqueId}${ext}`;
};

/**
 * Upload a file to S3-compatible storage
 * @param {Buffer} fileBuffer - The file data
 * @param {string} originalName - Original filename (for extension)
 * @param {string} folder - Folder path (e.g., 'boards', 'recipes', 'receipts')
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{key: string, url: string}>}
 */
const uploadFile = async (fileBuffer, originalName, folder, contentType) => {
  const fileName = generateFileName(originalName);
  const key = `${folder}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType
  });

  await s3Client.send(command);

  // Generate a long-lived signed URL (7 days)
  const url = await getSignedDownloadUrl(key, 7 * 24 * 60 * 60);

  return { key, url };
};

/**
 * Delete a file from S3-compatible storage
 * @param {string} key - The S3 key (path) of the file
 */
const deleteFile = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  await s3Client.send(command);
};

/**
 * Delete a file by its URL
 * @param {string} url - The public URL of the file
 */
const deleteFileByUrl = async (url) => {
  // Extract key from URL
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const bucketPrefix = `${endpoint}/${BUCKET_NAME}/`;

  if (url.startsWith(bucketPrefix)) {
    const key = url.substring(bucketPrefix.length);
    await deleteFile(key);
  }
};

/**
 * Get a signed URL for temporary private access
 * @param {string} key - The S3 key
 * @param {number} expiresIn - URL expiration in seconds (default 1 hour)
 */
const getSignedDownloadUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Allowed MIME types for uploads
 */
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

const ALLOWED_DOCUMENT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf'
];

/**
 * Validate file type
 */
const isValidImageType = (mimeType) => ALLOWED_IMAGE_TYPES.includes(mimeType);
const isValidDocumentType = (mimeType) => ALLOWED_DOCUMENT_TYPES.includes(mimeType);

/**
 * Max file size (10MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Download a file from S3 as a Buffer
 * @param {string} key - The S3 key
 * @returns {Promise<Buffer>}
 */
const downloadFileBuffer = async (key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Composite thumbnail configuration
 */
const COMPOSITE_CONFIG = {
  canvasWidth: 200,
  canvasHeight: 200,
  cellWidth: 99,
  cellHeight: 99,
  gap: 2,
  quality: 60
};

/**
 * Generate a 2x2 composite thumbnail from up to 4 image buffers
 * @param {Buffer[]} imageBuffers - Array of 1-4 image buffers
 * @returns {Promise<Buffer>} - Composite image as WebP buffer
 */
const generateCompositeThumbnail = async (imageBuffers) => {
  const { canvasWidth, canvasHeight, cellWidth, cellHeight, gap, quality } = COMPOSITE_CONFIG;

  const positions = [
    { left: 0, top: 0 },
    { left: cellWidth + gap, top: 0 },
    { left: 0, top: cellHeight + gap },
    { left: cellWidth + gap, top: cellHeight + gap }
  ];

  const compositeInputs = await Promise.all(
    imageBuffers.slice(0, 4).map(async (buf, index) => {
      const resized = await sharp(buf)
        .resize(cellWidth, cellHeight, { fit: 'cover', position: 'center' })
        .toBuffer();
      return {
        input: resized,
        left: positions[index].left,
        top: positions[index].top
      };
    })
  );

  // Fill empty cells with gray placeholder
  for (let i = imageBuffers.length; i < 4; i++) {
    const placeholder = await sharp({
      create: {
        width: cellWidth,
        height: cellHeight,
        channels: 4,
        background: { r: 220, g: 220, b: 230, alpha: 255 }
      }
    }).png().toBuffer();
    compositeInputs.push({
      input: placeholder,
      left: positions[i].left,
      top: positions[i].top
    });
  }

  return await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 240, g: 240, b: 245, alpha: 255 }
    }
  })
    .composite(compositeInputs)
    .webp({ quality })
    .toBuffer();
};

/**
 * Thumbnail configuration
 */
const THUMBNAIL_CONFIG = {
  width: 400,
  height: 400,
  quality: 70,
  format: 'webp'
};

/**
 * Generate a thumbnail from an image buffer
 * @param {Buffer} imageBuffer - Original image data
 * @returns {Promise<Buffer>} - Thumbnail buffer in WebP format
 */
const generateThumbnail = async (imageBuffer) => {
  return await sharp(imageBuffer)
    .resize(THUMBNAIL_CONFIG.width, THUMBNAIL_CONFIG.height, {
      fit: 'cover',
      position: 'center'
    })
    .webp({ quality: THUMBNAIL_CONFIG.quality })
    .toBuffer();
};

/**
 * Upload an image with automatic thumbnail generation
 * @param {Buffer} fileBuffer - The original image data
 * @param {string} originalName - Original filename (for extension)
 * @param {string} folder - Folder path
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{key: string, url: string, thumbnailKey: string, thumbnailUrl: string}>}
 */
const uploadImageWithThumbnail = async (fileBuffer, originalName, folder, contentType) => {
  // Generate unique base name
  const uniqueId = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  const baseName = `${timestamp}-${uniqueId}`;

  // Upload original image
  const originalKey = `${folder}/${baseName}${ext}`;
  const originalCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: originalKey,
    Body: fileBuffer,
    ContentType: contentType
  });
  await s3Client.send(originalCommand);

  // Generate and upload thumbnail
  const thumbnailBuffer = await generateThumbnail(fileBuffer);
  const thumbnailKey = `${folder}/thumbs/${baseName}.webp`;
  const thumbnailCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: thumbnailKey,
    Body: thumbnailBuffer,
    ContentType: 'image/webp'
  });
  await s3Client.send(thumbnailCommand);

  // Generate signed URLs (7 days)
  const url = await getSignedDownloadUrl(originalKey, 7 * 24 * 60 * 60);
  const thumbnailUrl = await getSignedDownloadUrl(thumbnailKey, 7 * 24 * 60 * 60);

  return {
    key: originalKey,
    url,
    thumbnailKey,
    thumbnailUrl
  };
};

module.exports = {
  uploadFile,
  deleteFile,
  deleteFileByUrl,
  getSignedDownloadUrl,
  downloadFileBuffer,
  isValidImageType,
  isValidDocumentType,
  generateThumbnail,
  generateCompositeThumbnail,
  uploadImageWithThumbnail,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE,
  THUMBNAIL_CONFIG,
  COMPOSITE_CONFIG
};

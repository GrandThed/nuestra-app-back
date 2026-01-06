const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, BUCKET_NAME } = require('../config/storage');
const path = require('path');
const crypto = require('crypto');

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
    ContentType: contentType,
    ACL: 'public-read'
  });

  await s3Client.send(command);

  // Construct public URL
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const url = `${endpoint}/${BUCKET_NAME}/${key}`;

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

module.exports = {
  uploadFile,
  deleteFile,
  deleteFileByUrl,
  getSignedDownloadUrl,
  isValidImageType,
  isValidDocumentType,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE
};

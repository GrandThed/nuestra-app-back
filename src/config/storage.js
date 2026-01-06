const { S3Client } = require('@aws-sdk/client-s3');

/**
 * S3 Client configured for Railway Storage Bucket
 * Railway provides S3-compatible storage via environment variables
 */
const s3Client = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  region: process.env.AWS_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  forcePathStyle: true // Required for S3-compatible services
});

const BUCKET_NAME = process.env.BUCKET_NAME;

module.exports = {
  s3Client,
  BUCKET_NAME
};

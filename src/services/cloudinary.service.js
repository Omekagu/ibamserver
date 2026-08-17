const cloudinary = require('../config/cloudinary');

const uploadBuffer = async (buffer, folder, resourceType = 'auto', extra = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `ibamhealth/${folder}`, resource_type: resourceType, ...extra },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

const deleteFile = async (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = { uploadBuffer, deleteFile };

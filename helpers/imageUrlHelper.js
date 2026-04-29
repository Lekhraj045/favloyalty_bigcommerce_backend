/**
 * Helper functions for managing email template image URLs
 * Handles both default images and user-uploaded images
 */

/**
 * Get the absolute URL for an image
 * Converts relative paths to absolute URLs for email compatibility
 * @param {string} imageUrl - The image URL (can be relative or absolute)
 * @returns {string|null} - Absolute URL for the image, or null if invalid
 */
function getAbsoluteImageUrl(imageUrl) {
  if (!imageUrl || imageUrl.trim() === "") {
    return null;
  }

  // If already an absolute URL (starts with http:// or https://), return as is
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  // Get base URL from environment variables
  const backendUrl = process.env.BACKEND_URL || process.env.SERVER_URL_PATH;
  const frontendUrl = process.env.FRONTEND_BASE_URL;
  const baseUrl = imageUrl.startsWith("/images") ? frontendUrl : backendUrl;

  if (!baseUrl) {
    console.warn(
      `⚠️  Cannot convert relative image URL to absolute. Set BACKEND_URL, SERVER_URL_PATH, or FRONTEND_BASE_URL in .env file. Image: ${imageUrl}`,
    );
    return imageUrl; // Return as is, might work if frontend handles it
  }

  // Remove trailing slash from baseUrl if present
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  // If imageUrl starts with /, append directly
  if (imageUrl.startsWith("/")) {
    return `${cleanBaseUrl}${imageUrl}`;
  }

  // Otherwise, add / between baseUrl and imageUrl
  return `${cleanBaseUrl}/${imageUrl}`;
}

/**
 * Get the relative path for storing in database
 * Converts absolute URLs to relative paths for consistent storage
 * @param {string} imageUrl - The image URL (can be relative or absolute)
 * @returns {string} - Relative path for database storage
 */
function getRelativeImagePath(imageUrl) {
  if (!imageUrl || imageUrl.trim() === "") {
    return "";
  }

  // If it's already a relative path, return as is
  if (imageUrl.startsWith("/")) {
    return imageUrl;
  }

  // If it's an absolute URL, extract the path
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    try {
      const url = new URL(imageUrl);
      return url.pathname; // Returns the path part (e.g., "/uploads/banner-images/image.jpg")
    } catch (error) {
      console.warn(`⚠️  Invalid URL format: ${imageUrl}`);
      return imageUrl;
    }
  }

  // If it doesn't start with /, add it
  return `/${imageUrl}`;
}

module.exports = {
  getAbsoluteImageUrl,
  getRelativeImagePath,
};

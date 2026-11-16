import { PDFDocument } from "pdf-lib";

const maxLogoBytes = 2 * 1024 * 1024;
const maxLetterheadBytes = 5 * 1024 * 1024;
const maxLogoDimension = 5000;

function assertDimensions(width, height) {
  if (!width || !height || width > maxLogoDimension || height > maxLogoDimension) {
    throw new RangeError("Logo dimensions must not exceed 5000 by 5000 pixels.");
  }
}

function jpegDimensions(image) {
  let offset = 2;
  while (offset + 4 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = image.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > image.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: image.readUInt16BE(offset + 7), height: image.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

const signatures = [
  {
    mimeType: "image/png",
    matches: (image) => image.length >= 24
      && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && image.subarray(12, 16).toString("ascii") === "IHDR",
    dimensions: (image) => ({ width: image.readUInt32BE(16), height: image.readUInt32BE(20) }),
  },
  {
    mimeType: "image/jpeg",
    matches: (image) => image.length >= 4 && image[0] === 0xff && image[1] === 0xd8 && image.at(-2) === 0xff && image.at(-1) === 0xd9,
    dimensions: jpegDimensions,
  },
];

function detectImageMimeType(image, maxBytes, label) {
  if (!Buffer.isBuffer(image) || image.length === 0 || image.length > maxBytes) {
    throw new RangeError(`Choose a ${label} smaller than ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }
  const signature = signatures.find((candidate) => candidate.matches(image));
  if (!signature) throw new TypeError("Use a valid PNG or JPEG logo image.");
  const dimensions = signature.dimensions(image);
  if (!dimensions) throw new TypeError("The logo image is incomplete or invalid.");
  assertDimensions(dimensions.width, dimensions.height);
  return signature.mimeType;
}

export function detectLogoMimeType(image) {
  return detectImageMimeType(image, maxLogoBytes, "logo image");
}

export async function detectLetterheadMimeType(content) {
  if (!Buffer.isBuffer(content) || content.length === 0 || content.length > maxLetterheadBytes) {
    throw new RangeError("Choose a letterhead smaller than 5 MB.");
  }
  const image = signatures.find((signature) => signature.matches(content));
  if (image) return detectImageMimeType(content, maxLetterheadBytes, "letterhead");
  if (content.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new TypeError("Use a valid single-page PDF, PNG, or JPEG letterhead.");
  }
  let document;
  try {
    document = await PDFDocument.load(content, { updateMetadata: false });
  } catch {
    throw new TypeError("The letterhead PDF is invalid or damaged.");
  }
  if (document.getPageCount() !== 1) {
    throw new TypeError("The letterhead PDF must contain exactly one page.");
  }
  const page = document.getPage(0);
  const { width, height } = page.getSize();
  if (!width || !height || width > 5000 || height > 5000) {
    throw new RangeError("Letterhead page dimensions must not exceed 5000 points.");
  }
  if (!page.node.Contents()) {
    throw new TypeError("The letterhead PDF must contain printable page content.");
  }
  try {
    await (await PDFDocument.create()).embedPdf(content, [0]);
  } catch {
    throw new TypeError("The letterhead PDF must contain printable page content.");
  }
  return "application/pdf";
}

export function logoImageFormat(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  throw new TypeError("The stored business logo has an unsupported image format.");
}

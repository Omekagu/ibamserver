const PDFDocument = require('pdfkit')

/**
 * Wraps an image buffer (JPEG or PNG) in a single-page PDF sized to fit the image.
 * Returns the original buffer unchanged if the mime type is already application/pdf.
 */
function toPdf (imageBuffer, mimeType) {
  if (mimeType === 'application/pdf') return Promise.resolve(imageBuffer)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Let pdfkit size the page to the image dimensions
    doc.addPage()
    doc.image(imageBuffer, 0, 0, {
      fit: [doc.page.width, doc.page.height],
      align: 'center',
      valign: 'center',
    })
    doc.end()
  })
}

module.exports = toPdf

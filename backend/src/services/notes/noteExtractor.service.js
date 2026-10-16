'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

const noteExtractorService = {
  async extract(filePath, mimeType) {
    if (!fs.existsSync(filePath)) {
      throw Object.assign(new Error('File not found on disk'), { statusCode: 404 });
    }

    const buffer = fs.readFileSync(filePath);

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return {
        text:      data.text || '',
        pageCount: data.numpages || null,
        wordCount: (data.text || '').split(/\s+/).filter(Boolean).length,
      };
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text:      result.value || '',
        pageCount: null,
        wordCount: (result.value || '').split(/\s+/).filter(Boolean).length,
      };
    }

    if (mimeType === 'text/plain') {
      const text = buffer.toString('utf8');
      return {
        text,
        pageCount: null,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
    }

    throw Object.assign(new Error(`Unsupported file type: ${mimeType}`), { statusCode: 400 });
  },
};

module.exports = noteExtractorService;

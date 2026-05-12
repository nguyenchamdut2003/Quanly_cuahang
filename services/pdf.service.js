const ejs = require('ejs');

async function renderViewToHtml(viewPath, data) {
  return ejs.renderFile(viewPath, data || {}, { async: true });
}

async function generatePdfFromHtml(html, options = {}) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (error) {
    error.message = 'Chua cai puppeteer. Chay: npm install puppeteer. Chi tiet: ' + error.message;
    throw error;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0']
    });
    await page.emulateMediaType('print');

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      },
      ...options
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderViewToHtml,
  generatePdfFromHtml
};

import { baseUrl } from '../lib/util.js';
import { twilioNumber } from '../lib/twilio.js';

// Contact card for the TeenLedger texting number. Sent as a picture message attachment and
// offered as a "Save to contacts" button, so Sunday texts show up as TeenLedger.
export default function handler(req, res) {
  const num = twilioNumber() || process.env.TEENLEDGER_PUBLIC_NUMBER || '';
  const site = baseUrl(req);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:;TeenLedger;;;',
    'FN:TeenLedger',
    'ORG:TeenLedger',
    num ? `TEL;TYPE=CELL,pref:${num}` : null,
    'EMAIL;TYPE=INTERNET:support@teenledger.app',
    `URL:${site}`,
    'NOTE:Your weekly spending texts. Text HELP for help.',
    'END:VCARD',
  ].filter(Boolean);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="TeenLedger.vcf"');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(lines.join('\r\n') + '\r\n');
}

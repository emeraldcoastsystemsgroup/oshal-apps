/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.0 (Lane FINH2): reading one mail message for a bill by fixed patterns, through the compiled module. A utility bill, a card statement (the whole balance, not the minimum payment) and an HTML invoice give the payee, the amount due and the due date; a payment receipt, mail with no amount due and mail with no due date give no bill; a due date without its year takes the mail's year or the next; a due date far from the mail is not believed; a sender with no name is named by its domain. Every sender, payee and figure is invented. Run: node --test tests/mail-parse.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const parse = require(path.join(__dirname, '..', 'routes', 'finance-mail-parse.js'));

const b64 = (s) => Buffer.from(s).toString('base64url');
/** A Gmail message (format=full) with one text part. */
function message(from, subject, body, date, mimeType = 'text/plain') {
  return { id: 'msg-1', internalDate: String(Date.parse(date)), snippet: '', payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }],
    mimeType: 'multipart/alternative', parts: [{ mimeType, body: { data: b64(body) } }] } };
}

test('a utility bill gives its payee, amount due and due date', () => {
  const read = parse.readBill(message('"Pinecrest Water Co Billing" <billing@pinecrest-water.example>', 'Your November water bill',
    'Hello Test Person. Amount due: $48.20. Payment due date: November 21, 2026. Pay online at the website.', '2026-11-03T10:00:00Z'));
  assert.deepEqual(read.bill, { messageId: 'msg-1', sender: '"Pinecrest Water Co Billing" <billing@pinecrest-water.example>', subject: 'Your November water bill',
    mailDate: '2026-11-03', payee: 'Pinecrest Water Co', amountCents: 4820, currency: 'USD', dueDate: '2026-11-21' });
});

test('a card statement gives the whole balance, not the minimum payment', () => {
  const read = parse.readBill(message('Harbor Card <statements@harborcard.example>', 'Your statement is ready',
    'Minimum payment due $35.00. Statement balance: $1,642.17. Payment Due Date 21 Nov', '2026-11-10T10:00:00Z'));
  assert.deepEqual([read.bill.payee, read.bill.amountCents, read.bill.dueDate], ['Harbor Card', 164217, '2026-11-21']);
});

test('an HTML invoice is read as words', () => {
  const html = '<html><style>p{color:red}</style><body><table><tr><td>Total due</td><td>&#36;112.40</td></tr><tr><td>Due by</td><td>12/02/2026</td></tr></table></body></html>';
  const read = parse.readBill(message('City Utilities <no-reply@cityutil.example>', 'Invoice', html, '2026-11-10T10:00:00Z', 'text/html'));
  assert.deepEqual([read.bill.payee, read.bill.amountCents, read.bill.dueDate], ['City Utilities', 11240, '2026-12-02']);
});

test('a receipt, mail with no amount due and mail with no due date give no bill', () => {
  assert.deepEqual(parse.readBill(message('Lantern Ridge <alerts@lanternridge.example>', 'Payment received', 'Thank you for your payment of $48.20. Amount due $0.00, due Dec 4.', '2026-11-10T10:00:00Z')), { left: 'receipt' });
  assert.deepEqual(parse.readBill(message('News <news@example.test>', 'Your bill of rights newsletter', 'Read about the statement of the week.', '2026-11-10T10:00:00Z')), { left: 'no-amount' });
  assert.deepEqual(parse.readBill(message('Shop <x@shop.example>', 'Your bill', 'Total due $20.00', '2026-11-10T10:00:00Z')), { left: 'no-date' });
});

test('a due date without its year takes the mail\'s year, or the next one in December; one far from the mail is not believed', () => {
  assert.equal(parse.dueDate('payment due jan 5', '2026-12-20'), '2027-01-05');
  assert.equal(parse.dueDate('payment due nov 21', '2026-11-03'), '2026-11-21');
  assert.equal(parse.dueDate('due date: 2027-09-01', '2026-11-03'), null, 'ten months after the mail is not this bill\'s due date');
  assert.equal(parse.dueDate('due by 11/21/26', '2026-11-03'), '2026-11-21');
});

test('a sender with no name is named by its domain, and the words billing and statements are dropped', () => {
  assert.equal(parse.payeeOf('<billing@mail.harborgas.example>'), 'Harborgas');
  assert.equal(parse.payeeOf('Maple Street Rentals Statements <s@maple.example>'), 'Maple Street Rentals');
  assert.equal(parse.amountDue('balance due $ 2,000'), 200000);
});

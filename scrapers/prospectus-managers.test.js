import assert from 'node:assert/strict';
import test from 'node:test';
import { matchDocuments, needsReading } from './prospectus-managers.js';
import * as allianz from './prospectus-managers/allianz.js';
import * as bahana from './prospectus-managers/bahana.js';
import * as batavia from './prospectus-managers/batavia.js';
import * as bni from './prospectus-managers/bni.js';
import * as bnpParibas from './prospectus-managers/bnp-paribas.js';
import * as bri from './prospectus-managers/bri.js';
import * as eastspring from './prospectus-managers/eastspring.js';
import * as hpam from './prospectus-managers/hpam.js';
import * as manulife from './prospectus-managers/manulife.js';
import * as panin from './prospectus-managers/panin.js';
import * as samuel from './prospectus-managers/samuel.js';
import * as sinarmas from './prospectus-managers/sinarmas.js';
import * as star from './prospectus-managers/star.js';
import * as syailendra from './prospectus-managers/syailendra.js';
import * as trimegah from './prospectus-managers/trimegah.js';
import * as uob from './prospectus-managers/uob.js';

const fund = (id, name, otherNames = '') => ({ id, name, other_names: otherNames });
const document = (name, url, shareClass) => ({ name, url, shareClass });

test('a document is about the fund of the same name, apart from case, punctuation and "Reksa Dana"', () => {
  const { byFund, unmatched } = matchDocuments([document('REKSA DANA Bahana Obligasi - Ganesha', 'a.pdf'), document('Bahana Unknown', 'b.pdf')], [fund('F1', 'Bahana Obligasi Ganesha')]);

  assert.equal(byFund.get('F1').url, 'a.pdf');
  assert.deepEqual(unmatched.map((item) => item.name), ['Bahana Unknown']);
});

test('the kind of fund before the brand does not tell two names apart', () => {
  const { byFund } = matchDocuments([document('Reksa Dana Syariah Bahana Sukuk Kelas D', 'a.pdf')], [fund('F1', 'Bahana Sukuk Kelas D'), fund('F2', 'Reksa Dana Indeks Bahana Sukuk Kelas D')]);

  assert.deepEqual([...byFund.keys()], ['F1', 'F2']);
});

test('a name is never matched loosely', () => {
  const { byFund, unmatched } = matchDocuments([document('Bahana Obligasi', 'a.pdf')], [fund('F1', 'Bahana Obligasi Ganesha'), fund('F2', 'Bahana Obligasi Plus')]);

  assert.equal(byFund.size, 0);
  assert.equal(unmatched.length, 1);
});

test('a document without a class covers every class of the fund, and a document with a class only its own', () => {
  const funds = [fund('A', 'Fund X Kelas A'), fund('B', 'Fund X Kelas B'), fund('C', 'Fund Y Kelas A'), fund('D', 'Fund Y Kelas B')];
  const { byFund } = matchDocuments([document('Fund X', 'x.pdf'), document('Fund Y Kelas B', 'y.pdf')], funds);

  assert.deepEqual([...byFund].map(([id, item]) => `${id}:${item.url}`), ['A:x.pdf', 'B:x.pdf', 'D:y.pdf']);
});

test('the class of a document can come apart from its name, and the other names of a fund count', () => {
  const { byFund } = matchDocuments([document('BNP Paribas Prima II', 'a.pdf', 'RK1'), document('Old Name', 'b.pdf')], [fund('F1', 'BNP Paribas Prima II Kelas RK1'), fund('F2', 'Something Else', 'Old Name|Other')]);

  assert.deepEqual([...byFund.keys()], ['F1', 'F2']);
});

test('a fund that two different files claim has no document, and the same file twice is fine', () => {
  const funds = [fund('F1', 'Fund X'), fund('F2', 'Fund Z')];
  const { byFund, ambiguous } = matchDocuments([document('Fund X', 'one.pdf'), document('Fund X', 'two.pdf'), document('Fund Z', 'z.pdf'), document('Fund Z', 'z.pdf')], funds);

  assert.deepEqual([...byFund.keys()], ['F2']);
  assert.deepEqual(ambiguous, [{ fundId: 'F1', urls: ['one.pdf', 'two.pdf'] }]);
});

test('a file is read again when it is new, at another address or version, or after a month without a version', () => {
  const row = { url: 'a.pdf', version: 'etag "1"', checked: '2026-10-01' };
  const read = (overrides) => needsReading({ row, url: 'a.pdf', version: 'etag "1"', today: '2026-10-09', ...overrides });

  assert.equal(read({}), false);
  assert.equal(read({ row: undefined }), true);
  assert.equal(read({ url: 'b.pdf' }), true);
  assert.equal(read({ version: 'etag "2"' }), true);
  assert.equal(read({ version: '', row: { ...row, version: '' } }), false);
  assert.equal(read({ version: '', row: { ...row, version: '', checked: '2026-09-01' } }), true);
});

test('Batavia: the fund pages come from the product list, and the name and prospectus from the page', () => {
  const list = '<a href="https://bpam.co.id/product/saham/batavia_dana_saham">x</a><a href="https://bpam.co.id/product/saham/batavia_dana_saham">y</a><a href="/product/investasi_bpam">z</a>';
  const page = '<h1 class="banner-title">Batavia Dana Saham</h1><a href="https://bpam.co.id/userfiles/uploads/files/FFS-SDS-ID.pdf?2"></a><a\n href="https://bpam.co.id/userfiles/uploads/files/PROSP-SDS-ID.pdf" target="_blank">';

  assert.deepEqual(batavia.parseProductLinks(list), ['https://bpam.co.id/product/saham/batavia_dana_saham']);
  assert.deepEqual(batavia.parseProductPage(page), { name: 'Batavia Dana Saham', url: 'https://bpam.co.id/userfiles/uploads/files/PROSP-SDS-ID.pdf' });
});

test('Bahana: the prospectus is an attachment of the API, which answers with the PDF inside a data address', () => {
  const documents = bahana.parseProducts({ Data: [{ PortfolioName: 'Bahana Likuid Plus', Prospectus: 'abc' }, { PortfolioName: 'No file', Prospectus: '' }] });
  const bytes = bahana.decodeAttachment({ fileUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.7 x').toString('base64')}` });

  assert.deepEqual(documents, [{ name: 'Bahana Likuid Plus', url: 'https://bahanatcw.com/api/tcw/attachment/abc', link: 'https://bahanatcw.com/product/reksadana' }]);
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7 x');
  assert.throws(() => bahana.decodeAttachment({ error: 'Not found' }), /Not found/);
});

test('BNP Paribas: the class of a share is the first word between the brackets, unless it only says there are none', () => {
  const rows = [
    { type: 'DOC_FP', language: 'IND', compart_name: 'BNP PARIBAS PRIMA II', share_name: 'BNP PARIBAS PRIMA II [RK1, C]', direct_url: 'https://docfinder/1' },
    { type: 'DOC_FP', language: 'IND', compart_name: 'BNP PARIBAS PRIMA II', share_name: 'BNP PARIBAS PRIMA II [DR1, C]', direct_url: 'https://docfinder/1' },
    { type: 'DOC_FP', language: 'IND', compart_name: 'BNP PARIBAS PESONA', share_name: 'BNP PARIBAS PESONA [CLASSIC, C]', direct_url: 'https://docfinder/2' },
    { type: 'DOC_FACTSHEET', language: 'IND', compart_name: 'BNP PARIBAS PESONA', share_name: 'BNP PARIBAS PESONA [CLASSIC, C]', direct_url: 'https://docfinder/3' },
    { type: 'DOC_FP', language: 'ENG', compart_name: 'BNP PARIBAS PESONA', share_name: 'BNP PARIBAS PESONA [CLASSIC, C]', direct_url: 'https://docfinder/4' },
  ];

  assert.deepEqual(bnpParibas.parseDocuments(rows).map(({ name, shareClass, url }) => [name, shareClass, url]), [
    ['BNP PARIBAS PRIMA II', 'RK1', 'https://docfinder/1'],
    ['BNP PARIBAS PRIMA II', 'DR1', 'https://docfinder/1'],
    ['BNP PARIBAS PESONA', undefined, 'https://docfinder/2'],
  ]);
});

test('BRI: the document labelled as a prospectus is taken, whatever the spelling', () => {
  const post = (title, ...documents) => ({ title, relation: { galeries: { media: documents.map((item) => ({ document: item })) } } });
  const response = { data: { relation: { posts: [
    post('BRI Mawar', { name: 'Fund Fact Sheet', default: 'https://x/ffs.pdf' }, { name: 'Prospektus', default: 'https://x/mawar.pdf' }),
    post('BRI Seruni', { name: 'Prospectus', default: 'https://x/seruni.pdf' }),
    post('BRI Without', { name: 'Fund Fact Sheet', default: 'https://x/ffs2.pdf' }),
  ] } } };

  assert.deepEqual(bri.parseDocuments(response), [{ name: 'BRI Mawar', url: 'https://x/mawar.pdf' }, { name: 'BRI Seruni', url: 'https://x/seruni.pdf' }]);
});

test('BNI: funds are the headings of the category pages, and the prospectus is the link labelled so', () => {
  const list = '<div class="post-heading">\n <a href="https://www.bni-am.co.id/bni-am-dana-likuid">\n <h3>BNI-AM Dana Likuid Kelas A</h3>';
  const page = '<a href="https://www.bni-am.co.id/uploads/topics/1.pdf" class="x"> Lembar Fakta Dana </a><a href="https://www.bni-am.co.id/uploads/topics/2.pdf"><i></i>\n Prospektus\n</a>';

  assert.deepEqual(bni.parseFundLinks(list), [{ url: 'https://www.bni-am.co.id/bni-am-dana-likuid', name: 'BNI-AM Dana Likuid Kelas A' }]);
  assert.equal(bni.parseProspectusLink(page), 'https://www.bni-am.co.id/uploads/topics/2.pdf');
});

test('Eastspring: a fund page links the prospectus that all the classes of the fund share', () => {
  const list = '<a href="/id/funddetails/eastspring-idr-fixed-income-fund-kelas-a/idn000193802"></a><a href="/id/funddetails/eastspring-idr-fixed-income-fund-kelas-a/idn000193802"></a>';
  const page = "<li><a href='/iddocs/PRO/ei_idrfixedincome_pr_id.pdf'  target=\"_blank\">Prospektus</a></li>";

  assert.deepEqual(eastspring.parseFundLinks(list), ['/id/funddetails/eastspring-idr-fixed-income-fund-kelas-a/idn000193802']);
  assert.equal(eastspring.nameOfFundLink(eastspring.parseFundLinks(list)[0]), 'eastspring idr fixed income fund kelas a');
  assert.equal(eastspring.parsePageProspectus(page), '/iddocs/PRO/ei_idrfixedincome_pr_id.pdf');
});

test('Manulife: a fund with a prospectus in the site\'s list has the file of its umbrella', () => {
  const response = { all: JSON.stringify([
    { fundName: 'Manulife Dana Kas II Kelas D1', fundUmbrellaCode: 'MDK_II', documents: { latest: [{ aemKey: 'prospectus' }, { aemKey: 'factsheet' }] } },
    { fundName: 'Manulife Without', fundUmbrellaCode: 'MWO', documents: { latest: [{ aemKey: 'factsheet' }] } },
  ]) };

  assert.deepEqual(manulife.parseDocuments(response), [{ name: 'Manulife Dana Kas II Kelas D1', url: 'https://www.manulifeim.co.id/content/dam/wam/id/id/funds/prospectus/MDK_II-prospectus.pdf' }]);
});

test('STAR: the prospectus is the file titled so on the product page, and spaces in its address are encoded', () => {
  const page = '<div class="item-title">Fund Fact Sheet Agustus</div><div class="item-file"><a href="https://star-am.com/a.pdf"></a></div><div class="item-title">Pembaharuan Prospektus STAR</div><div class="item-file"><a href="https://star-am.com/b c.pdf"></a></div>';

  assert.equal(star.parseProspectusLink(page), 'https://star-am.com/b c.pdf');
  assert.deepEqual(star.parseProducts([{ title: { rendered: 'STAR Balanced &#038; Co' }, link: 'https://star-am.com/p/' }]), [{ name: 'STAR Balanced &#038; Co', page: 'https://star-am.com/p/' }]);
});

test('Syailendra: the abbreviation in a fund\'s title is not part of its name', () => {
  const page = '<title>Syailendra Equity Opportunity Fund (SEOF) Kelas A | Syailendra Capital</title><a href="https://x/ffs.pdf" target="_blank"><img src="a.png">\n<h3>Product Focus</h3></a><a href="https://x/prosp.pdf" target="_blank"><img src="a.png" alt="ffs-4">\n<h3>Prospektus</h3></a>';

  assert.deepEqual(syailendra.parseFundPage(page), { name: 'Syailendra Equity Opportunity Fund Kelas A', url: 'https://x/prosp.pdf' });
});

test('Trimegah: a fund page names the fund in its title and has the prospectus as its third download', () => {
  const page = '<title>REKSA DANA TRAM ALPHA</title><a class="download-button" target="_blank" href="https://x/info.pdf">\n<img alt="" src="a.svg" />\n<span>Info Produk</span></a><a class="download-button" target="_blank" href="https://x/prosp.pdf">\n<img alt="" src="a.svg" />\n<span>Prospektus</span></a>';

  assert.deepEqual(trimegah.parseFundPage(page), { name: 'REKSA DANA TRAM ALPHA', url: 'https://x/prosp.pdf' });
});

test('Panin: the prospectus is the link of the file headed so, not the fact sheet before it', () => {
  const page = "<a href='https://rss/FFS.pdf' target=\"_blank\"><div class=\"col\"><figure><img src=\"a.png\"></figure><h5>Fund Fact Sheet</h5></div></a><a href='https://rss/Forms/A B.pdf' target=\"_blank\"><div class=\"col\"><figure><img src=\"a.png\"></figure><h5>Prospektus</h5></div></a>";

  assert.equal(panin.parseProspectusLink(page), 'https://rss/Forms/A B.pdf');
});

test('Allianz: the files are listed with the date of the prospectus in their folder, and the name is the link text', () => {
  const html = '<a class="c-link" href="https://id.allianzgi.com/-/media/allianzgi/ap/indonesia/documents/prospectus/31-03-2026/14-pp2026-prospektus-fif-2.pdf?rev=-1&amp;hash=AB" aria-label="x">\n<span class="c-link__text">Allianz Fixed Income Fund 2 \u2013 Prospektus</span></a>';

  assert.deepEqual(allianz.parseDocuments(html), [{ name: 'Allianz Fixed Income Fund 2', url: 'https://id.allianzgi.com/-/media/allianzgi/ap/indonesia/documents/prospectus/31-03-2026/14-pp2026-prospektus-fif-2.pdf' }]);
});

test('Samuel: the code after the name of a fund is not part of its name', () => {
  const html = "<a href=\"https://www.sam.co.id/admin/wp-content/uploads/downloads/2026/03/prospektus-sam-dana-kas-sdk-2026.pdf\" target=\"_blank\">\n\t<i class='fas fa-file-pdf'></i> SAM Dana Kas (SDK)\t</a>";

  assert.deepEqual(samuel.parseDocuments(html), [{ name: 'SAM Dana Kas', url: 'https://www.sam.co.id/admin/wp-content/uploads/downloads/2026/03/prospektus-sam-dana-kas-sdk-2026.pdf' }]);
});

test('UOB: a page with one Indonesian prospectus gives it, and a page of several funds gives none', () => {
  const one = '<title>UOBAM Dana Rupiah | UOB</title><a href="../../web-resources/a/prospektus-uobam-dana-rupiah.pdf"></a><a href="../../web-resources/a/prospektus-uobam-dana-rupiah-en.pdf"></a>';
  const several = '<title>RDT | UOB</title><a href="../../web-resources/a/RDT I - PROSPEKTUS.pdf"></a><a href="../../web-resources/a/RDT II - PROSPEKTUS.pdf"></a>';

  assert.deepEqual(uob.parseFundPage(one, 'https://www.uobam.co.id/products-and-services/x.html'), { name: 'UOBAM Dana Rupiah', url: 'https://www.uobam.co.id/web-resources/a/prospektus-uobam-dana-rupiah.pdf' });
  assert.equal(uob.parseFundPage(several, 'https://www.uobam.co.id/products-and-services/x.html').url, '');
});

test('Sinarmas: the data of a server action is in the line numbered 1, and any other answer is an error', () => {
  const text = '0:{"a":"$@1"}\n1:{"success":true,"rawdata":{"data":[{"id":"002","name":"Simas Satu"}]}}\n';

  assert.deepEqual(sinarmas.parseActionResponse(text), [{ id: '002', name: 'Simas Satu' }]);
  assert.throws(() => sinarmas.parseActionResponse('<html>Not found</html>'), /did not answer/);
});

test('HPAM: the prospectus is a file on Google Drive, taken from its share link', () => {
  assert.equal(hpam.downloadAddressOf('https://drive.google.com/file/d/abc_123/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=abc_123');
  assert.equal(hpam.downloadAddressOf(''), '');
  assert.deepEqual(hpam.parseProduct({ data: { produk: { nama_produk: 'HPAM Government Bond', file_propektus: 'https://drive.google.com/file/d/x/view' } } }), { name: 'HPAM Government Bond', link: 'https://drive.google.com/file/d/x/view' });
});

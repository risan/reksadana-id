import { fetchText } from './fetcher.js';

export const manager = 'Panin Asset Management, PT';

const SITE = 'https://www.panin-am.co.id';

// The list of funds on the manager's site opens each fund with a form that needs a session, and the address of a fund's page
// (`/produk/<slug>/dokumen`) is not made of its name. The slugs are kept here, with the fund's name. To add a fund, open its
// page from https://www.panin-am.co.id/produk in a browser and take the slug from the address.
const FUNDS = [
  ['maksima', 'Panin Dana Maksima'],
  ['prima', 'Panin Dana Prima'],
  ['infrastrukturbertumbuh', 'Panin Dana Infrastruktur Bertumbuh'],
  ['ultima', 'Panin Dana Ultima'],
  ['teladan', 'Panin Dana Teladan'],
  ['betaone', 'Panin Beta One'],
  ['paninidx-30kelasa', 'Panin IDX-30 Kelas A'],
  ['paninsrikehatikelasa', 'Panin Sri Kehati Kelas A'],
  ['syariahsaham', 'Panin Dana Syariah Saham'],
  ['globalshariaequityfund', 'RDS Panin Global Sharia Equity Fund'],
  ['prioritas', 'Panin Dana Prioritas'],
  ['usdollar', 'Reksa Dana Panin Dana US Dollar'],
  ['syariahberimbang', 'Panin Dana Syariah Berimbang'],
  ['unggulan', 'Panin Dana Unggulan'],
  ['bersamaplus', 'Panin Dana Bersama Plus'],
  ['bersama', 'Panin Dana Bersama'],
  ['paninprioritassehatkelasb', 'Panin Prioritas Sehat Kelas B'],
  ['pgiii', 'Panin Gebyar Indonesia II'],
  ['utamaplus2', 'Panin Dana Utama Plus 2'],
  ['pendapatanberkala', 'Panin Dana Pendapatan Berkala'],
  ['pendapatanutama', 'Panin Dana Pendapatan Utama'],
  ['danalikuid', 'Panin Dana Likuid'],
  ['danalikuidsyariah', 'Panin Dana Likuid Syariah'],
  ['panindanalikuidusdollar', 'Panin Dana Likuid US Dollar'],
  ['etfidx30dinamis', 'PANIN ETF IDX30 DINAMIS'],
  ['terproteksipanin26', 'Terproteksi Panin 26'],
  ['terproteksipanin35', 'Terproteksi Panin 35'],
  ['terproteksipanin36', 'Terproteksi Panin 36'],
  ['terproteksipanin37', 'Terproteksi Panin 37'],
  ['terproteksipanin38', 'Terproteksi Panin 38'],
  ['terproteksipanin39', 'Terproteksi Panin 39'],
  ['terproteksipanin41', 'Terproteksi Panin 41'],
  ['terproteksipaninsdg1', 'Sustainable Development Goals 1'],
  ['terproteksipanin40', 'Terproteksi Panin 40'],
  ['terproteksipanin42', 'Terproteksi Panin 42'],
  ['terproteksipanin43', 'Terproteksi Panin 43'],
  ['terproteksipanin44', 'Terproteksi Panin 44'],
  ['terproteksipanin45', 'Terproteksi Panin 45'],
  ['terproteksipanin46', 'Terproteksi Panin 46'],
  ['terproteksipanin47', 'Terproteksi Panin 47'],
  ['terproteksipanin49', 'Terproteksi Panin 49'],
  ['cahayaamanah1', 'RDST Panin Cahaya Amanah 1'],
];

// A fund's documents page links each file with a heading under it ("Fund Fact Sheet", "Prospektus", "Laporan Keuangan").
export const parseProspectusLink = (html) => html.match(/<a href='([^']+)'[^>]*>(?:(?!<\/a>)[\s\S])*?<h5>Prospektus<\/h5>/)?.[1] ?? '';

export const listDocuments = async () => {
  const documents = [];

  for (const [slug, name] of FUNDS) {
    const link = parseProspectusLink(await fetchText(`${SITE}/produk/${slug}/dokumen`));

    if (link !== '') {
      documents.push({ name, url: link.replaceAll(' ', '%20') });
    }
  }

  return documents;
};
